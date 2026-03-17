import json
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, UploadFile
from typing import Optional
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

import auth_utils
import models
from database import get_db

router = APIRouter(prefix="/missions", tags=["Missions"])

UPLOAD_DIR  = os.getenv("UPLOAD_DIR", "elaborazioni")
CORE_SCRIPT = os.path.join(os.path.dirname(os.path.dirname(__file__)), "core", "inferenzanuovosito_cli.py")
os.makedirs(UPLOAD_DIR, exist_ok=True)

# Maps status label → front-end progress %
STATUS_PROGRESS = {
    "in_coda":     5,
    "taglio_tile": 30,
    "inferenza":   65,
    "completato":  100,
    "errore":      -1,
}


# ---------------------------------------------------------------------------
# Background task — runs in a thread pool worker
# ---------------------------------------------------------------------------

def _run_pipeline(job_id: str, tif_path: str, tfw_path: str, job_dir: str):
    from database import DATABASE_URL
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    )
    Sess = sessionmaker(bind=engine)
    db = Sess()

    try:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job:
            return

        job.status = "taglio_tile"
        db.commit()

        # Usa il modello sul disco persistente se disponibile
        model_dir = UPLOAD_DIR  # model_best.pth viene scaricato qui all'avvio
        cmd = [
            sys.executable, CORE_SCRIPT,
            "--tif",     tif_path,
            "--tfw",     tfw_path,
            "--outdir",  job_dir,
            "--weights", model_dir,
        ]
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
        )

        job = db.query(models.Job).filter(models.Job.id == job_id).first()

        if result.returncode != 0:
            job.status = "errore"
            job.log    = (result.stderr or result.stdout or "Errore sconosciuto")[-6000:]
            db.commit()
            return

        # Parse results
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

        job.status          = "completato"
        job.result_path     = job_dir
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


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.post("/upload")
async def upload_mission(
    background_tasks: BackgroundTasks,
    tif_termico:      UploadFile       = File(...),
    tfw_termico:      UploadFile       = File(...),
    tif_rgb:          UploadFile       = File(...),
    tfw_rgb:          UploadFile       = File(...),
    panel_model:      Optional[str]    = Form(None),
    panel_dimensions: Optional[str]    = Form(None),
    panel_efficiency: Optional[float]  = Form(None),
    panel_temp_coeff: Optional[float]  = Form(None),
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    if current.credits <= 0:
        raise HTTPException(
            status_code=402,
            detail="Crediti esauriti. Acquista nuovi crediti per continuare.",
        )

    job_id  = str(uuid.uuid4())
    job_dir = os.path.join(UPLOAD_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    # Save all 4 files — normalizza estensione in minuscolo, rimuove spazi
    def _norm(filename: str) -> str:
        filename = filename.strip()
        name, ext = os.path.splitext(filename)
        return name.strip() + ext.lower()

    tif_termico_path = os.path.join(job_dir, "termico_" + _norm(tif_termico.filename))
    tfw_termico_path = os.path.join(job_dir, "termico_" + _norm(tfw_termico.filename))
    tif_rgb_path     = os.path.join(job_dir, "rgb_"     + _norm(tif_rgb.filename))
    tfw_rgb_path     = os.path.join(job_dir, "rgb_"     + _norm(tfw_rgb.filename))

    for src, dst in [
        (tif_termico, tif_termico_path),
        (tfw_termico, tfw_termico_path),
        (tif_rgb,     tif_rgb_path),
        (tfw_rgb,     tfw_rgb_path),
    ]:
        with open(dst, "wb") as f:
            shutil.copyfileobj(src.file, f)

    # Deduct 1 credit
    current.credits -= 1

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

    # Pipeline runs on the thermal ortomosaic
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
        "json":    ("Rilevamenti_Pannelli.json",    "application/json"),
        "csv":     ("Rilevamenti_Pannelli.csv",     "text/csv"),
        "geojson": ("Rilevamenti_Pannelli.geojson", "application/geo+json"),
        "kml":     ("Mappa_Pannelli.kml",           "application/vnd.google-earth.kml+xml"),
        "kmz":     ("Mappa_Pannelli.kmz",           "application/vnd.google-earth.kmz"),
    }

    if file_type not in FILE_MAP:
        raise HTTPException(status_code=400, detail=f"Tipo '{file_type}' non supportato. Usa: {', '.join(FILE_MAP)}")

    fname, media_type = FILE_MAP[file_type]
    file_path = os.path.join(job.result_path, fname)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File non ancora disponibile")

    return FileResponse(path=file_path, filename=fname, media_type=media_type)


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
