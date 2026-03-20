import os
import shutil
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from typing import Optional
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
import httpx

import auth_utils
from auth_utils import sync_credits_by_vat
import models
import storage_utils
from database import get_db
from email_utils import send_email

router = APIRouter(prefix="/missions", tags=["Missions"])

_LOCAL_TMP         = os.getenv("UPLOAD_DIR", "/tmp/elaborazioni")
RUNPOD_API_KEY     = os.getenv("RUNPOD_API_KEY", "")
RUNPOD_ENDPOINT_ID = os.getenv("RUNPOD_ENDPOINT_ID", "")

os.makedirs(_LOCAL_TMP, exist_ok=True)

_OUTPUT_FILENAMES = {
    "Rilevamenti_Pannelli.json",
    "Rilevamenti_Pannelli.csv",
    "Rilevamenti_Pannelli.geojson",
    "Mappa_Pannelli.kml",
    "Mappa_Pannelli.kmz",
}

STATUS_PROGRESS = {
    "in_coda":     5,
    "taglio_tile": 30,
    "inferenza":   65,
    "completato":  100,
    "errore":      -1,
}


# ---------------------------------------------------------------------------
# Background task — upload su Supabase poi avvia ML server
# ---------------------------------------------------------------------------

def _upload_and_dispatch(job_id: str, job_dir: str, tif_name: str, tfw_name: str):
    """Carica i file su Supabase e chiama il ML server."""
    from database import DATABASE_URL
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(DATABASE_URL, pool_pre_ping=True)
    db = sessionmaker(bind=engine)()

    supabase_prefix  = f"jobs/{job_id}"
    tif_storage_path = ""
    tfw_storage_path = ""

    try:
        # Upload tutti i file di input su Supabase
        for fname in os.listdir(job_dir):
            fpath = os.path.join(job_dir, fname)
            if not os.path.isfile(fpath):
                continue
            spath = f"{supabase_prefix}/{fname}"
            storage_utils.upload_file(fpath, spath)
            if fname == tif_name:
                tif_storage_path = spath
            elif fname == tfw_name:
                tfw_storage_path = spath

        # Invia job a RunPod Serverless
        if not RUNPOD_API_KEY or not RUNPOD_ENDPOINT_ID:
            raise RuntimeError("RUNPOD_API_KEY / RUNPOD_ENDPOINT_ID non configurati")

        resp = httpx.post(
            f"https://api.runpod.io/v2/{RUNPOD_ENDPOINT_ID}/run",
            json={"input": {
                "job_id":           job_id,
                "tif_storage_path": tif_storage_path,
                "tfw_storage_path": tfw_storage_path,
            }},
            headers={"Authorization": f"Bearer {RUNPOD_API_KEY}"},
            timeout=30,
        )
        resp.raise_for_status()

    except Exception as exc:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if job:
            job.status = "errore"
            job.log    = f"Dispatch RunPod fallito: {exc}"
            db.commit()
    finally:
        db.close()
        shutil.rmtree(job_dir, ignore_errors=True)


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_mission(
    background_tasks: BackgroundTasks,
    tif_termico:      UploadFile           = File(...),
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
        raise HTTPException(status_code=402, detail="Crediti esauriti. Acquista nuovi crediti per continuare.")

    job_id  = str(uuid.uuid4())
    job_dir = os.path.join(_LOCAL_TMP, job_id)
    os.makedirs(job_dir, exist_ok=True)

    def _norm(filename: str) -> str:
        name, ext = os.path.splitext(filename.strip())
        return name.strip() + ext.lower()

    # Salva file localmente (temp, vengono caricati su Supabase in background)
    tif_fname = "termico_" + _norm(tif_termico.filename)
    with open(os.path.join(job_dir, tif_fname), "wb") as f:
        shutil.copyfileobj(tif_termico.file, f)

    tfw_fname = ""
    if tfw_termico and tfw_termico.filename:
        tfw_fname = "termico_" + _norm(tfw_termico.filename)
        with open(os.path.join(job_dir, tfw_fname), "wb") as f:
            shutil.copyfileobj(tfw_termico.file, f)

    if tif_rgb and tif_rgb.filename:
        with open(os.path.join(job_dir, "rgb_" + _norm(tif_rgb.filename)), "wb") as f:
            shutil.copyfileobj(tif_rgb.file, f)

    if tfw_rgb and tfw_rgb.filename:
        with open(os.path.join(job_dir, "rgb_" + _norm(tfw_rgb.filename)), "wb") as f:
            shutil.copyfileobj(tfw_rgb.file, f)

    # Scala credito
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

    # Upload su Supabase + dispatch al ML server (in background)
    background_tasks.add_task(_upload_and_dispatch, job_id, job_dir, tif_fname, tfw_fname)

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


@router.get("/history")
def list_jobs_history(
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Alias di /missions usato dal frontend per lo storico elaborazioni."""
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
    if job.company_id != current.id and not current.is_admin:
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
    if job.company_id != current.id and not current.is_admin:
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
        raise HTTPException(status_code=400, detail=f"Tipo non supportato. Usa: {', '.join(FILE_MAP)}")

    storage_path = f"{job.result_path}/{FILE_MAP[file_type]}"
    try:
        signed_url = storage_utils.get_signed_url(storage_path, expires_in=300)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File non disponibile: {e}")
    return RedirectResponse(url=signed_url)


@router.get("/{job_id}/download-input")
def download_input(
    job_id: str,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job non trovato")
    if job.company_id != current.id and not current.is_admin:
        raise HTTPException(status_code=403, detail="Accesso negato")
    if not job.tif_filename:
        raise HTTPException(status_code=404, detail="File input non disponibile")
    storage_path = f"jobs/{job_id}/{job.tif_filename}"
    try:
        signed_url = storage_utils.get_signed_url(storage_path, expires_in=300)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File non disponibile: {e}")
    return RedirectResponse(url=signed_url)


@router.get("/{job_id}/input-files")
def list_input_files(
    job_id: str,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Elenca i file di input di un job con URL firmati per il download."""
    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job non trovato")
    if job.company_id != current.id and not current.is_admin:
        raise HTTPException(status_code=403, detail="Accesso negato")

    all_files = storage_utils.list_files(f"jobs/{job_id}")
    result = []
    for f in all_files:
        name = f["name"]
        if name in _OUTPUT_FILENAMES:
            continue
        try:
            url = storage_utils.get_signed_url(f"jobs/{job_id}/{name}", expires_in=300)
            result.append({"name": name, "url": url, "size_mb": f.get("size_mb", 0)})
        except Exception:
            pass
    return result


@router.get("/trial-status")
def trial_status(
    request,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    # Controlla se qualcuno della stessa azienda (stessa P.IVA) ha già richiesto il trial
    if current.vat_number:
        company_ids = [
            c.id for c in db.query(models.Company).filter(
                models.Company.vat_number == current.vat_number,
                models.Company.deleted_at.is_(None),
            ).all()
        ]
        already = db.query(models.TrialRequest).filter(
            models.TrialRequest.company_id.in_(company_ids)
        ).first()
    else:
        already = db.query(models.TrialRequest).filter(
            models.TrialRequest.company_id == current.id
        ).first()
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

    # Blocco per azienda (stessa P.IVA), non solo per IP
    if current.vat_number:
        company_ids = [
            c.id for c in db.query(models.Company).filter(
                models.Company.vat_number == current.vat_number,
                models.Company.deleted_at.is_(None),
            ).all()
        ]
        if db.query(models.TrialRequest).filter(
            models.TrialRequest.company_id.in_(company_ids)
        ).first():
            raise HTTPException(status_code=400, detail="La tua azienda ha già inviato una richiesta di prova gratuita.")
    elif db.query(models.TrialRequest).filter(models.TrialRequest.company_id == current.id).first():
        raise HTTPException(status_code=400, detail="Hai già inviato una richiesta di prova.")

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
              {"" if not message else f'<tr><td style="padding:12px 0;"><span style="color:#64748b;font-size:13px;">Messaggio</span><br><p style="color:#1e293b;font-size:14px;line-height:1.6;margin:6px 0 0;background:#f8fafc;border-left:3px solid #f59e0b;padding:12px;">{message}</p></td></tr>'}
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
        "id":              j.id,
        "status":          j.status,
        "tif_filename":    j.tif_filename,
        "panels_detected": j.panels_detected,
        "hotspot_count":   j.hotspot_count,
        "degraded_count":  j.degraded_count,
        "created_at":      j.created_at.isoformat(),
        "completed_at":    j.completed_at.isoformat() if j.completed_at else None,
    }
    if j.status == "errore":
        d["log"] = j.log or "Nessun dettaglio disponibile."
    return d
