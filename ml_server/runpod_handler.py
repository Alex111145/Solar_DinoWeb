"""
SolarDino — RunPod Serverless Handler
Viene chiamato da RunPod per ogni job di inferenza.
"""
import os
import sys
import json
import shutil
import subprocess
import urllib.request
from pathlib import Path
from datetime import datetime, timezone

import runpod
import httpx
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

ROOT = Path(__file__).parent.parent
sys.path.insert(0, str(ROOT))

import models
import storage_utils

DATABASE_URL = os.getenv("DATABASE_URL", "")
TMP_DIR      = os.getenv("TMP_DIR", "/tmp/ml_jobs")
WEIGHTS_DIR  = os.getenv("WEIGHTS_DIR", "/tmp/weights")
CORE_SCRIPT  = str(ROOT / "core" / "inferenzanuovosito_cli.py")

os.makedirs(TMP_DIR, exist_ok=True)
os.makedirs(WEIGHTS_DIR, exist_ok=True)

engine  = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=2, max_overflow=3)
Session = sessionmaker(bind=engine)


def _download_from_storage(storage_path: str, local_path: str) -> None:
    url     = f"{storage_utils.SUPABASE_URL}/storage/v1/object/{storage_utils.STORAGE_BUCKET}/{storage_path}"
    headers = storage_utils._headers()
    with httpx.stream("GET", url, headers=headers, timeout=600) as r:
        r.raise_for_status()
        with open(local_path, "wb") as f:
            for chunk in r.iter_bytes(chunk_size=1024 * 1024):
                f.write(chunk)


def _ensure_weights() -> str:
    model_path = os.path.join(WEIGHTS_DIR, "model_best.pth")
    if os.path.exists(model_path):
        return WEIGHTS_DIR
    model_url = os.getenv("MODEL_PTH_URL", "")
    if not model_url:
        raise RuntimeError("MODEL_PTH_URL non configurato")
    print(f"[ML] Download model_best.pth...")
    urllib.request.urlretrieve(model_url, model_path)
    print(f"[ML] Modello scaricato ({os.path.getsize(model_path) // 1024 // 1024} MB)")
    return WEIGHTS_DIR


def handler(job):
    job_input         = job["input"]
    job_id            = job_input["job_id"]
    tif_storage_path  = job_input["tif_storage_path"]
    tfw_storage_path  = job_input.get("tfw_storage_path", "")

    db      = Session()
    job_dir = os.path.join(TMP_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    try:
        job_rec = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job_rec:
            return {"ok": False, "error": "Job non trovato nel DB"}

        # ── 1. Download input ────────────────────────────────────────────────
        job_rec.status = "taglio_tile"
        db.commit()

        tif_local = os.path.join(job_dir, os.path.basename(tif_storage_path))
        _download_from_storage(tif_storage_path, tif_local)

        tfw_local = ""
        if tfw_storage_path:
            tfw_local = os.path.join(job_dir, os.path.basename(tfw_storage_path))
            _download_from_storage(tfw_storage_path, tfw_local)

        weights_dir = _ensure_weights()

        # ── 2. Inferenza ─────────────────────────────────────────────────────
        job_rec.status = "inferenza"
        db.commit()

        cmd = [
            sys.executable, CORE_SCRIPT,
            "--tif",     tif_local,
            "--tfw",     tfw_local,
            "--outdir",  job_dir,
            "--weights", weights_dir,
        ]
        result = subprocess.run(cmd, capture_output=True, text=True)

        job_rec = db.query(models.Job).filter(models.Job.id == job_id).first()

        if result.returncode != 0:
            job_rec.status = "errore"
            job_rec.log    = (result.stderr or result.stdout or "Errore sconosciuto")[-6000:]
            db.commit()
            return {"ok": False, "error": job_rec.log}

        # ── 3. Parse risultati ───────────────────────────────────────────────
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

        # ── 4. Upload risultati su Supabase ──────────────────────────────────
        supabase_prefix = f"jobs/{job_id}"
        for fname in os.listdir(job_dir):
            fpath = os.path.join(job_dir, fname)
            if os.path.isfile(fpath):
                storage_utils.upload_file(fpath, f"{supabase_prefix}/{fname}")

        # ── 5. Aggiorna DB ───────────────────────────────────────────────────
        job_rec.status          = "completato"
        job_rec.result_path     = supabase_prefix
        job_rec.panels_detected = panels_count
        job_rec.hotspot_count   = hotspot_count
        job_rec.degraded_count  = degraded_count
        job_rec.log             = (result.stdout or "")[-3000:]
        job_rec.completed_at    = datetime.now(timezone.utc)

        db.add(models.UsageLog(
            company_id   = job_rec.company_id,
            job_id       = job_id,
            panels_count = panels_count,
            credits_used = 1,
        ))
        db.commit()

        print(f"[ML] Job {job_id} completato — {panels_count} pannelli")
        return {"ok": True, "job_id": job_id, "panels": panels_count}

    except Exception as exc:
        print(f"[ML] ERRORE job {job_id}: {exc}")
        try:
            job_rec = db.query(models.Job).filter(models.Job.id == job_id).first()
            if job_rec:
                job_rec.status = "errore"
                job_rec.log    = str(exc)
                db.commit()
        except Exception:
            pass
        return {"ok": False, "error": str(exc)}

    finally:
        db.close()
        shutil.rmtree(job_dir, ignore_errors=True)


runpod.serverless.start({"handler": handler})
