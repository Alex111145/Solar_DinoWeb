"""
SolarDino ML Server — gira su Oracle Cloud (o qualsiasi server potente).
Riceve job dall'API, scarica i file da Supabase/S3, fa inferenza, carica i risultati.
"""
import json
import os
import shutil
import subprocess
import sys
import threading
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import FastAPI, HTTPException, Header
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

# Aggiunge la directory padre al path per importare models, storage_utils
ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import models
import storage_utils
from database import DATABASE_URL

# ── Config ─────────────────────────────────────────────────────────────────
ML_SECRET   = os.getenv("ML_SERVER_SECRET", "")
TMP_DIR     = os.getenv("TMP_DIR", "/tmp/ml_jobs")
WEIGHTS_DIR = os.getenv("WEIGHTS_DIR", "/tmp/weights")
CORE_SCRIPT = str(ROOT / "core" / "inferenzanuovosito_cli.py")

os.makedirs(TMP_DIR, exist_ok=True)
os.makedirs(WEIGHTS_DIR, exist_ok=True)

engine  = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=3, max_overflow=5)
Session = sessionmaker(bind=engine)

app = FastAPI(title="SolarDino ML Server", version="1.0.0")


# ── Schemas ─────────────────────────────────────────────────────────────────
class RunRequest(BaseModel):
    job_id:           str
    tif_storage_path: str
    tfw_storage_path: str = ""


# ── Routes ──────────────────────────────────────────────────────────────────
@app.get("/health")
def health():
    return {"status": "ok", "service": "SolarDino ML Server"}


@app.post("/run")
def run_job(
    body:     RunRequest,
    x_secret: str = Header(None, alias="x-secret"),
):
    if ML_SECRET and x_secret != ML_SECRET:
        raise HTTPException(status_code=403, detail="Non autorizzato")

    # Avvia in un thread separato — risponde subito all'API
    t = threading.Thread(
        target=_run_pipeline,
        args=(body.job_id, body.tif_storage_path, body.tfw_storage_path),
        daemon=True,
    )
    t.start()
    return {"ok": True, "job_id": body.job_id}


# ── Pipeline ────────────────────────────────────────────────────────────────
def _download_from_storage(storage_path: str, local_path: str) -> None:
    """Scarica un file da Supabase Storage."""
    url = f"{storage_utils.SUPABASE_URL}/storage/v1/object/{storage_utils.STORAGE_BUCKET}/{storage_path}"
    headers = storage_utils._headers()
    with httpx.stream("GET", url, headers=headers, timeout=600) as r:
        r.raise_for_status()
        with open(local_path, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=1024 * 1024):
                f.write(chunk)


def _ensure_weights() -> str:
    """Scarica model_best.pth se non già presente."""
    model_path = os.path.join(WEIGHTS_DIR, "model_best.pth")
    if os.path.exists(model_path):
        return WEIGHTS_DIR
    model_url = os.getenv("MODEL_PTH_URL", "")
    if not model_url:
        raise RuntimeError("MODEL_PTH_URL non configurato e model_best.pth assente")
    print(f"[ML] Download model_best.pth...")
    urllib.request.urlretrieve(model_url, model_path)
    print(f"[ML] Modello scaricato ({os.path.getsize(model_path) // 1024 // 1024} MB)")
    return WEIGHTS_DIR


def _run_pipeline(job_id: str, tif_storage_path: str, tfw_storage_path: str):
    db      = Session()
    job_dir = os.path.join(TMP_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    try:
        job = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job:
            return

        # ── 1. Download input da Supabase ───────────────────────────────────
        job.status = "taglio_tile"
        db.commit()

        tif_local = os.path.join(job_dir, os.path.basename(tif_storage_path))
        _download_from_storage(tif_storage_path, tif_local)

        tfw_local = ""
        if tfw_storage_path:
            tfw_local = os.path.join(job_dir, os.path.basename(tfw_storage_path))
            _download_from_storage(tfw_storage_path, tfw_local)

        weights_dir = _ensure_weights()

        # ── 2. Inferenza ────────────────────────────────────────────────────
        job.status = "inferenza"
        db.commit()

        cmd = [
            sys.executable, CORE_SCRIPT,
            "--tif",     tif_local,
            "--tfw",     tfw_local,
            "--outdir",  job_dir,
            "--weights", weights_dir,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)

        job = db.query(models.Job).filter(models.Job.id == job_id).first()

        if result.returncode != 0:
            job.status = "errore"
            job.log    = (result.stderr or result.stdout or "Errore sconosciuto")[-6000:]
            db.commit()
            return

        # ── 3. Parse risultati ──────────────────────────────────────────────
        panels_count = hotspot_count = degraded_count = 0
        output_json  = os.path.join(job_dir, "Rilevamenti_Pannelli.json")
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

        # ── 4. Upload risultati su Supabase ─────────────────────────────────
        supabase_prefix = f"jobs/{job_id}"
        for fname in os.listdir(job_dir):
            fpath = os.path.join(job_dir, fname)
            if os.path.isfile(fpath):
                storage_utils.upload_file(fpath, f"{supabase_prefix}/{fname}")

        # ── 5. Aggiorna DB ──────────────────────────────────────────────────
        job.status          = "completato"
        job.result_path     = supabase_prefix
        job.panels_detected = panels_count
        job.hotspot_count   = hotspot_count
        job.degraded_count  = degraded_count
        job.log             = (result.stdout or "")[-3000:]
        job.completed_at    = datetime.now(timezone.utc)

        db.add(models.UsageLog(
            company_id   = job.company_id,
            job_id       = job_id,
            panels_count = panels_count,
            credits_used = 1,
        ))
        db.commit()
        print(f"[ML] Job {job_id} completato — {panels_count} pannelli")

    except Exception as exc:
        print(f"[ML] ERRORE job {job_id}: {exc}")
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
        shutil.rmtree(job_dir, ignore_errors=True)
