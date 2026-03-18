import json
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from typing import Optional
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

import auth_utils
from auth_utils import sync_credits_by_vat
import models
import storage_utils
from database import get_db
from email_utils import send_email

router = APIRouter(prefix="/missions", tags=["Missions"])

# Directory temporanea locale — solo durante l'esecuzione della pipeline
_LOCAL_TMP = os.getenv("UPLOAD_DIR", "elaborazioni")
CORE_SCRIPT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "core", "inferenzanuovosito_cli.py")
os.makedirs(_LOCAL_TMP, exist_ok=True)

# Maps status label → front-end progress %
STATUS_PROGRESS = {
    "in_coda":     5,
    "taglio_tile": 30,
    "inferenza":   65,
    "completato":  100,
    "errore":      -1,
}

# Risultati che vogliamo tenere su Supabase (output della pipeline)
_RESULT_FILES = [
    "Rilevamenti_Pannelli.json",
    "Rilevamenti_Pannelli.csv",
    "Rilevamenti_Pannelli.geojson",
    "Mappa_Pannelli.kml",
    "Mappa_Pannelli.kmz",
]


# ---------------------------------------------------------------------------
# Background task — runs in a thread pool worker
# ---------------------------------------------------------------------------

def _run_pipeline(job_id: str, tif_path: str, tfw_path: str, job_dir: str):
    from database import DATABASE_URL
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    Sess = sessionmaker(bind=engine)
    db = Sess()

    try:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job:
            return

        job.status = "taglio_tile"
        db.commit()

        # Usa model_best.pth dalla directory locale (scaricato all'avvio da Supabase)
        cmd = [
            sys.executable, CORE_SCRIPT,
            "--tif",     tif_path,
            "--tfw",     tfw_path,
            "--outdir",  job_dir,
            "--weights", _LOCAL_TMP,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)

        job = db.query(models.Job).filter(models.Job.id == job_id).first()

        if result.returncode != 0:
            job.status = "errore"
            job.log    = (result.stderr or result.stdout or "Errore sconosciuto")[-6000:]
            db.commit()
            return

        # Parse risultati dal JSON locale
        panels_count   = 0
        hotspot_count  = 0
        degraded_count = 0

        output_json = os.path.join(job_dir, "Rilevamenti_Pannelli.json")
        if os.path.exists(output_json):
            try:
                with open(output_json) as f:
                    data = json.load(f)
                pannelli       = data.get("pannelli", [])
                panels_count   = len(pannelli)
                hotspot_count  = sum(1 for p in pannelli if p.get("class_id") == 1)
                degraded_count = sum(1 for p in pannelli if p.get("class_id") == 2)
            except Exception:
                pass

        # ── Upload su Supabase Storage ────────────────────────────────────────
        supabase_prefix = f"jobs/{job_id}"
        try:
            job.status = "inferenza"
            db.commit()

            # Input files (tif, tfw, rgb…)
            for fname in os.listdir(job_dir):
                fpath = os.path.join(job_dir, fname)
                if os.path.isfile(fpath):
                    storage_utils.upload_file(fpath, f"{supabase_prefix}/{fname}")
        except Exception as upload_err:
            job.status = "errore"
            job.log    = f"Upload Supabase fallito: {upload_err}"
            db.commit()
            return

        job.status          = "completato"
        job.result_path     = supabase_prefix   # path su Supabase, non locale
        job.panels_detected = panels_count
        job.hotspot_count   = hotspot_count
        job.degraded_count  = degraded_count
        job.log             = (result.stdout or "")[-3000:]
        job.completed_at    = datetime.now(timezone.utc)

        usage = models.UsageLog(
            company_id   = job.company_id,
            job_id       = job_id,
            panels_count = panels_count,
            credits_used = 1,
        )
        db.add(usage)
        db.commit()

    except Exception as exc:
        try:
            job = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job:
                job.status = "errore"
                job.log    = str(exc)
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
        # Cancella sempre la directory locale temporanea
        try:
            shutil.rmtree(job_dir, ignore_errors=True)
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_mission(
    background_tasks: BackgroundTasks,
    tif_termico:      UploadFile          = File(...),
    tfw_termico:      Optional[UploadFile] = File(None),
    tif_rgb:          Optional[UploadFile] = File(None),
    tfw_rgb:          Optional[UploadFile] = File(None),
    panel_model:      Optional[str]        = Form(None),
    panel_dimensions: Optional[str]        = Form(None),
    panel_efficiency: Optional[float]      = Form(None),
    panel_temp_coeff: Optional[float]      = Form(None),
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    if not current.is_active:
        raise HTTPException(status_code=403, detail="Account disabilitato")
    if current.credits <= 0:
        raise HTTPException(
            status_code=402,
            detail="Crediti esauriti. Acquista nuovi crediti per continuare.",
        )

    job_id  = str(uuid.uuid4())
    job_dir = os.path.join(_LOCAL_TMP, job_id)
    os.makedirs(job_dir, exist_ok=True)

    def _norm(filename: str) -> str:
        filename = filename.strip()
        name, ext = os.path.splitext(filename)
        return name.strip() + ext.lower()

    tif_termico_path = os.path.join(job_dir, "termico_" + _norm(tif_termico.filename))
    with open(tif_termico_path, "wb") as f:
        shutil.copyfileobj(tif_termico.file, f)

    tfw_termico_path = ""
    if tfw_termico and tfw_termico.filename:
        tfw_termico_path = os.path.join(job_dir, "termico_" + _norm(tfw_termico.filename))
        with open(tfw_termico_path, "wb") as f:
            shutil.copyfileobj(tfw_termico.file, f)

    if tif_rgb and tif_rgb.filename:
        tif_rgb_path = os.path.join(job_dir, "rgb_" + _norm(tif_rgb.filename))
        with open(tif_rgb_path, "wb") as f:
            shutil.copyfileobj(tif_rgb.file, f)

    if tfw_rgb and tfw_rgb.filename:
        tfw_rgb_path = os.path.join(job_dir, "rgb_" + _norm(tfw_rgb.filename))
        with open(tfw_rgb_path, "wb") as f:
            shutil.copyfileobj(tfw_rgb.file, f)

    # Scala 1 credito e sincronizza tutti gli account con stessa P.IVA
    current.credits -= 1
    sync_credits_by_vat(db, current.vat_number, current.credits)

    job = models.Job(
        id               = job_id,
        company_id       = current.id,
        status           = "in_coda",
        tif_filename     = tif_termico.filename,
        panel_model      = panel_model or None,
        panel_dimensions = panel_dimensions or None,
        panel_efficiency = panel_efficiency,
        panel_temp_coeff = panel_temp_coeff,
    )
    db.add(job)
    db.commit()

    background_tasks.add_task(_run_pipeline, job_id, tif_termico_path, tfw_termico_path, job_dir)

    return {
        "job_id":          job_id,
        "message":         "Missione avviata con successo",
        "credits_rimasti": current.credits,
    }


@router.get("")
def list_jobs(
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    jobs = (
        db.query(models.Job)
        .filter(models.Job.company_id == current.id)
        .order_by(models.Job.created_at.desc())
        .limit(100)
        .all()
    )
    return [_job_dict(j) for j in jobs]


@router.get("/{job_id}/status")
def job_status(
    job_id: str,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job non trovato")

    if job.company_id != current.id and current.email != auth_utils.ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Accesso negato")

    d = _job_dict(job)
    d["progress"] = STATUS_PROGRESS.get(job.status, 0)
    return d


@router.get("/{job_id}/download/{file_type}")
def download_result(
    job_id: str,
    file_type: str,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job non trovato")

    if job.company_id != current.id and current.email != auth_utils.ADMIN_EMAIL:
        raise HTTPException(status_code=403, detail="Accesso negato")

    if job.status != "completato":
        raise HTTPException(status_code=400, detail="Analisi non ancora completata")

    FILE_MAP = {
        "json":    "Rilevamenti_Pannelli.json",
        "csv":     "Rilevamenti_Pannelli.csv",
        "geojson": "Rilevamenti_Pannelli.geojson",
        "kml":     "Mappa_Pannelli.kml",
        "kmz":     "Mappa_Pannelli.kmz",
    }

    if file_type not in FILE_MAP:
        raise HTTPException(status_code=400, detail=f"Tipo '{file_type}' non supportato. Usa: {', '.join(FILE_MAP)}")

    fname = FILE_MAP[file_type]
    storage_path = f"{job.result_path}/{fname}"

    try:
        signed_url = storage_utils.get_signed_url(storage_path, expires_in=300)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File non disponibile: {e}")

    return RedirectResponse(url=signed_url)


@router.get("/trial-status")
def trial_status(
    request,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Ritorna se l'IP corrente ha già inviato una richiesta di prova."""
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
    already = db.query(models.TrialRequest).filter(models.TrialRequest.ip == ip).first()
    return {"already_requested": already is not None}


@router.post("/request-trial")
def request_trial(
    body: dict,
    request,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    forwarded = request.headers.get("x-forwarded-for")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")

    if db.query(models.TrialRequest).filter(models.TrialRequest.ip == ip).first():
        raise HTTPException(status_code=400, detail="Hai già inviato una richiesta di prova da questo indirizzo IP.")

    message = (body.get("message") or "").strip()

    db.add(models.TrialRequest(company_id=current.id, ip=ip, message=message))
    db.commit()

    html = f"""<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.13);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#f59e0b;font-size:22px;font-weight:700;">☀️ SolarDino</h1>
            <p style="margin:6px 0 0;color:#94a3b8;font-size:13px;text-transform:uppercase;">Richiesta prova gratuita</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:40px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:13px;">Azienda</span><br>
                <strong style="color:#0f172a;font-size:15px;">{current.ragione_sociale or current.name}</strong>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:13px;">Referente</span><br>
                <strong style="color:#0f172a;">{current.name}</strong>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:13px;">Email</span><br>
                <strong style="color:#0f172a;">{current.email}</strong>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:13px;">P.IVA</span><br>
                <strong style="color:#0f172a;">{current.vat_number or "—"}</strong>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:13px;">IP</span><br>
                <strong style="color:#0f172a;">{ip}</strong>
              </td></tr>
              {"" if not message else f'''<tr><td style="padding:12px 0;">
                <span style="color:#64748b;font-size:13px;">Messaggio</span><br>
                <p style="color:#1e293b;font-size:14px;line-height:1.6;margin:6px 0 0;background:#f8fafc;border-left:3px solid #f59e0b;padding:12px;">{message}</p>
              </td></tr>'''}
            </table>
            <div style="margin-top:28px;text-align:center;">
              <a href="https://solar-dinoweb.onrender.com/admin"
                 style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#0f172a;font-weight:700;padding:14px 32px;border-radius:12px;text-decoration:none;font-size:15px;">
                Vai all'admin → aggiungi 1 credito
              </a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""

    send_email("agervasini1@gmail.com", f"SolarDino — Prova gratuita: {current.ragione_sociale or current.name}", html)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _job_dict(j: models.Job) -> dict:
    d = {
        "id":               j.id,
        "status":           j.status,
        "tif_filename":     j.tif_filename,
        "panels_detected":  j.panels_detected,
        "hotspot_count":    j.hotspot_count,
        "degraded_count":   j.degraded_count,
        "created_at":       j.created_at.isoformat(),
        "completed_at":     j.completed_at.isoformat() if j.completed_at else None,
    }
    if j.status == "errore":
        d["log"] = j.log or "Nessun dettaglio disponibile."
    return d
