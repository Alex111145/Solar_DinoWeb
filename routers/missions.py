import collections
import html as html_mod
import os
import shutil
import threading
import time
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from typing import Optional
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
import httpx

import auth_utils
from auth_utils import sync_credits_by_vat
import models
import storage_utils
from database import get_db
from email_utils import send_email

router = APIRouter(prefix="/missions", tags=["Missions"])

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://solar-dinoweb.fly.dev")

# ── Upload rate limiting: max 10 upload per company per ora ────────────────
_UPLOAD_ATTEMPTS: dict[int, list[float]] = collections.defaultdict(list)
_UPLOAD_LOCK = threading.Lock()
_MAX_UPLOADS_PER_HOUR = 10
_UPLOAD_WINDOW = 3600

# ── Limite dimensione file: 500 MB per file ────────────────────────────────
_MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024  # 5 GB

_LOCAL_TMP         = os.getenv("UPLOAD_DIR", "/tmp/elaborazioni")
MODAL_ENDPOINT_URL  = os.getenv("MODAL_ENDPOINT_URL", "")
MODAL_WEBHOOK_SECRET = os.getenv("MODAL_WEBHOOK_SECRET", "")

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

def _upload_and_dispatch(job_id: str, job_dir: str, tif_name: str, tfw_name: str, is_bonus: bool = False):
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

        # Invia job a Modal Serverless
        if not MODAL_ENDPOINT_URL:
            raise RuntimeError("MODAL_ENDPOINT_URL non configurato")

        headers = {"Content-Type": "application/json"}
        if MODAL_WEBHOOK_SECRET:
            headers["x-secret"] = MODAL_WEBHOOK_SECRET

        resp = httpx.post(
            MODAL_ENDPOINT_URL,
            json={
                "job_id":           job_id,
                "tif_storage_path": tif_storage_path,
                "tfw_storage_path": tfw_storage_path,
                "watermark":        is_bonus,   # True = aggiungi watermark alle immagini di output
            },
            headers=headers,
            timeout=30,
        )
        resp.raise_for_status()

    except Exception as exc:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if job:
            job.status = "errore"
            job.log    = f"Dispatch Modal fallito: {exc}"
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

    # Rate limiting upload per azienda
    now = time.time()
    with _UPLOAD_LOCK:
        _UPLOAD_ATTEMPTS[current.id] = [t for t in _UPLOAD_ATTEMPTS[current.id] if now - t < _UPLOAD_WINDOW]
        if len(_UPLOAD_ATTEMPTS[current.id]) >= _MAX_UPLOADS_PER_HOUR:
            raise HTTPException(status_code=429, detail="Troppi upload nell'ultima ora. Riprova più tardi.")
        _UPLOAD_ATTEMPTS[current.id].append(now)

    # Controllo dimensione file
    for uf in [tif_termico, tfw_termico, tif_rgb, tfw_rgb]:
        if uf and uf.filename:
            uf.file.seek(0, 2)
            size = uf.file.tell()
            uf.file.seek(0)
            if size > _MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail="File troppo grande. Limite massimo: 5 GB.")

    job_id  = str(uuid.uuid4())
    job_dir = os.path.join(_LOCAL_TMP, job_id)
    os.makedirs(job_dir, exist_ok=True)

    _ALLOWED_TIF = {".tif", ".tiff"}
    _ALLOWED_TFW = {".tfw", ".tifw", ".wld"}

    def _norm(filename: str) -> str:
        # os.path.basename rimuove qualsiasi "../" o path traversal
        safe = os.path.basename(filename.strip())
        name, ext = os.path.splitext(safe)
        return name.strip() + ext.lower()

    def _check_ext(filename: str, allowed: set) -> None:
        _, ext = os.path.splitext(filename.strip())
        if ext.lower() not in allowed:
            raise HTTPException(status_code=400, detail="Formato file non supportato. Usa .tif/.tiff per immagini e .tfw/.wld per i worldfile.")

    _check_ext(tif_termico.filename, _ALLOWED_TIF)
    if tfw_termico and tfw_termico.filename:
        _check_ext(tfw_termico.filename, _ALLOWED_TFW)
    if tif_rgb and tif_rgb.filename:
        _check_ext(tif_rgb.filename, _ALLOWED_TIF)
    if tfw_rgb and tfw_rgb.filename:
        _check_ext(tfw_rgb.filename, _ALLOWED_TFW)

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

    # ── Scala credito con lock a livello DB (previene race condition) ─────────
    # with_for_update() acquisisce un row-level lock: se 2 richieste arrivano
    # simultaneamente, la seconda aspetta il commit della prima.
    locked = (
        db.query(models.Company)
        .filter(models.Company.id == current.id)
        .with_for_update()
        .first()
    )
    if not locked or locked.credits <= 0:
        shutil.rmtree(job_dir, ignore_errors=True)
        raise HTTPException(status_code=402, detail="Crediti esauriti.")

    is_bonus = bool(locked.bonus_credits and locked.bonus_credits > 0)
    if is_bonus:
        locked.bonus_credits -= 1
    locked.credits -= 1
    sync_credits_by_vat(db, None, locked.credits, locked.ragione_sociale)

    job = models.Job(
        id               = job_id,
        company_id       = current.id,
        status           = "in_coda",
        tif_filename     = tif_termico.filename,
        panel_model      = panel_model or None,
        panel_dimensions = panel_dimensions or None,
        panel_efficiency = panel_efficiency,
        panel_temp_coeff = panel_temp_coeff,
        is_bonus_job     = is_bonus,
    )
    db.add(job)
    db.commit()

    # Upload su Supabase + dispatch al ML server (in background)
    background_tasks.add_task(_upload_and_dispatch, job_id, job_dir, tif_fname, tfw_fname, is_bonus)

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
    if job.company_id != current.id and not current._priv:
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
    if job.company_id != current.id and not current._priv:
        raise HTTPException(status_code=403, detail="Accesso negato")
    if job.status != "completato":
        raise HTTPException(status_code=400, detail="Analisi non ancora completata")
    if job.is_bonus_job and not current._priv:
        raise HTTPException(
            status_code=403,
            detail="I file di output non sono scaricabili con il credito di benvenuto. Acquista crediti per sbloccare i download.",
        )

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
    except Exception:
        raise HTTPException(status_code=404, detail="File non disponibile")
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
    if job.company_id != current.id and not current._priv:
        raise HTTPException(status_code=403, detail="Accesso negato")
    if not job.tif_filename:
        raise HTTPException(status_code=404, detail="File input non disponibile")
    storage_path = f"jobs/{job_id}/{job.tif_filename}"
    try:
        signed_url = storage_utils.get_signed_url(storage_path, expires_in=300)
    except Exception:
        raise HTTPException(status_code=404, detail="File non disponibile")
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
    if job.company_id != current.id and not current._priv:
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
    # Controlla se qualcuno della stessa azienda (stessa ragione sociale) ha già richiesto il trial
    if current.ragione_sociale:
        from sqlalchemy import func as sqlfunc
        company_ids = [
            c.id for c in db.query(models.Company).filter(
                sqlfunc.lower(sqlfunc.trim(models.Company.ragione_sociale)) == current.ragione_sociale.strip().lower(),
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

    # Blocco per azienda (stessa ragione sociale)
    if current.ragione_sociale:
        from sqlalchemy import func as sqlfunc
        company_ids = [
            c.id for c in db.query(models.Company).filter(
                sqlfunc.lower(sqlfunc.trim(models.Company.ragione_sociale)) == current.ragione_sociale.strip().lower(),
                models.Company.deleted_at.is_(None),
            ).all()
        ]
        if db.query(models.TrialRequest).filter(
            models.TrialRequest.company_id.in_(company_ids)
        ).first():
            raise HTTPException(status_code=400, detail="La tua azienda ha già inviato una richiesta di prova gratuita.")
    elif db.query(models.TrialRequest).filter(models.TrialRequest.company_id == current.id).first():
        raise HTTPException(status_code=400, detail="Hai già inviato una richiesta di prova.")

    message = (body.get("message") or "").strip()[:1000]  # limite lunghezza
    db.add(models.TrialRequest(company_id=current.id, ip=ip, message=message))
    db.commit()

    # Escape user content before inserting into HTML email
    rs_safe  = html_mod.escape(current.ragione_sociale or current.name or "—")
    em_safe  = html_mod.escape(current.email or "—")
    ip_safe  = html_mod.escape(ip)
    msg_safe = html_mod.escape(message)

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
                <strong style="color:#0f172a;font-size:15px;">{rs_safe}</strong>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:13px;">Email</span><br>
                <strong style="color:#0f172a;">{em_safe}</strong>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:13px;">IP</span><br>
                <strong style="color:#0f172a;">{ip_safe}</strong>
              </td></tr>
              {"" if not message else f'<tr><td style="padding:12px 0;"><span style="color:#64748b;font-size:13px;">Messaggio</span><br><p style="color:#1e293b;font-size:14px;line-height:1.6;margin:6px 0 0;background:#f8fafc;border-left:3px solid #f59e0b;padding:12px;">{msg_safe}</p></td></tr>'}
            </table>
            <div style="margin-top:28px;text-align:center;">
              <a href="{FRONTEND_URL}/sys-ctrl"
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
        "is_bonus_job":    bool(j.is_bonus_job),
    }
    if j.status == "errore":
        d["log"] = j.log or "Nessun dettaglio disponibile."
    return d
