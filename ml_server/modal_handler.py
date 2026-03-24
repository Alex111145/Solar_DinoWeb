"""
SolarDino — Modal Serverless Handler
Deploy: modal deploy ml_server/modal_handler.py
"""
import modal
from pydantic import BaseModel

class JobInput(BaseModel):
    job_id: str
    tif_storage_path: str
    tfw_storage_path: str = ""

# ── Image (Modal la builda sui suoi server, niente Docker locale) ─────────────
cuda_image = (
    modal.Image.from_registry(
        "pytorch/pytorch:2.6.0-cuda12.4-cudnn9-devel",
        add_python="3.10",
    )
    .apt_install([
        "libgdal-dev", "gdal-bin",
        "libgl1-mesa-glx", "libglib2.0-0",
        "ninja-build", "gcc", "g++", "git",
    ])
    .pip_install([
        "httpx==0.27.2",
        "sqlalchemy==2.0.35",
        "psycopg2-binary==2.9.9",
        "python-dotenv==1.0.1",
        "fvcore", "cloudpickle", "omegaconf", "hydra-core",
        "pycocotools", "timm",
        "opencv-python-headless",
        "rasterio", "numpy", "pandas",
        "geopandas", "shapely", "pyproj", "simplekml",
        "fastapi", "pydantic",
    ])
    # Copia il codice sorgente nell'immagine per compilare detectron2/maskdino
    .add_local_dir("core", remote_path="/app/core", copy=True)
    .add_local_dir("ml_server", remote_path="/app/ml_server", copy=True)
    .add_local_file("models.py", remote_path="/app/models.py", copy=True)
    .add_local_file("storage_utils.py", remote_path="/app/storage_utils.py", copy=True)
    .run_commands(
        # Installa detectron2 da sorgente locale
        "pip install --no-cache-dir --no-build-isolation -e /app/core/libs/detectron2",
        # Compila MultiScaleDeformableAttention (MaskDINO) — FORCE_CUDA forza CUDAExtension anche senza GPU nel build container
        "cd /app/core/libs/maskdino/modeling/pixel_decoder/ops && FORCE_CUDA=1 TORCH_CUDA_ARCH_LIST='8.6' python setup.py build_ext --inplace",
    )
)

app = modal.App("solardino-ml", image=cuda_image)


# ── Secrets (crea "solardino-ml" in modal.com/secrets) ───────────────────────
secrets = [modal.Secret.from_name("solardino-ml")]


# ── Web endpoint ─────────────────────────────────────────────────────────────
@app.function(
    gpu="A10G",
    timeout=3600,
    secrets=secrets,
)
@modal.web_endpoint(method="POST")
def run(item: JobInput) -> dict:
    import os, sys, json, shutil, subprocess, urllib.request
    from datetime import datetime, timezone
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    sys.path.insert(0, "/app")
    import models
    import storage_utils

    DATABASE_URL = os.getenv("DATABASE_URL", "")
    TMP_DIR      = "/tmp/ml_jobs"
    WEIGHTS_DIR  = "/tmp/weights"
    CORE_SCRIPT  = "/app/core/inferenzanuovosito_cli.py"

    os.makedirs(TMP_DIR, exist_ok=True)
    os.makedirs(WEIGHTS_DIR, exist_ok=True)

    engine  = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=2, max_overflow=3)
    Session = sessionmaker(bind=engine)

    job_id           = item.job_id
    tif_storage_path = item.tif_storage_path
    tfw_storage_path = item.tfw_storage_path

    import httpx
    def _download(storage_path, local_path):
        url     = f"{storage_utils.SUPABASE_URL}/storage/v1/object/{storage_utils.STORAGE_BUCKET}/{storage_path}"
        headers = storage_utils._headers()
        with httpx.stream("GET", url, headers=headers, timeout=600) as r:
            r.raise_for_status()
            with open(local_path, "wb") as f:
                for chunk in r.iter_bytes(chunk_size=1024 * 1024):
                    f.write(chunk)

    def _ensure_weights():
        model_path = os.path.join(WEIGHTS_DIR, "model_best.pth")
        if os.path.exists(model_path):
            return WEIGHTS_DIR
        model_url = os.getenv("MODEL_PTH_URL", "")
        if not model_url:
            raise RuntimeError("MODEL_PTH_URL non configurato")
        urllib.request.urlretrieve(model_url, model_path)
        return WEIGHTS_DIR

    db      = Session()
    job_dir = os.path.join(TMP_DIR, job_id)
    os.makedirs(job_dir, exist_ok=True)

    try:
        job_rec = db.query(models.Job).filter(models.Job.id == job_id).first()
        if not job_rec:
            return {"ok": False, "error": "Job non trovato"}

        job_rec.status = "taglio_tile"; db.commit()

        tif_local = os.path.join(job_dir, os.path.basename(tif_storage_path))
        _download(tif_storage_path, tif_local)

        tfw_local = ""
        if tfw_storage_path:
            tfw_local = os.path.join(job_dir, os.path.basename(tfw_storage_path))
            _download(tfw_storage_path, tfw_local)

        weights_dir = _ensure_weights()

        job_rec.status = "inferenza"; db.commit()

        result = subprocess.run(
            [sys.executable, CORE_SCRIPT,
             "--tif", tif_local, "--tfw", tfw_local,
             "--outdir", job_dir, "--weights", weights_dir],
            capture_output=True, text=True,
        )

        job_rec = db.query(models.Job).filter(models.Job.id == job_id).first()

        if result.returncode != 0:
            job_rec.status = "errore"
            job_rec.log    = (result.stderr or result.stdout or "Errore sconosciuto")[-6000:]
            db.commit()
            return {"ok": False, "error": job_rec.log}

        panels_count = hotspot_count = degraded_count = 0
        output_json  = os.path.join(job_dir, "Rilevamenti_Pannelli.json")
        if os.path.exists(output_json):
            try:
                with open(output_json) as f:
                    pannelli       = json.load(f).get("pannelli", [])
                panels_count   = len(pannelli)
                hotspot_count  = sum(1 for p in pannelli if p.get("class_id") == 1)
                degraded_count = sum(1 for p in pannelli if p.get("class_id") == 2)
            except Exception:
                pass

        supabase_prefix = f"jobs/{job_id}"
        for fname in os.listdir(job_dir):
            fpath = os.path.join(job_dir, fname)
            if os.path.isfile(fpath):
                storage_utils.upload_file(fpath, f"{supabase_prefix}/{fname}")

        job_rec.status          = "completato"
        job_rec.result_path     = supabase_prefix
        job_rec.panels_detected = panels_count
        job_rec.hotspot_count   = hotspot_count
        job_rec.degraded_count  = degraded_count
        job_rec.log             = (result.stdout or "")[-3000:]
        job_rec.completed_at    = datetime.now(timezone.utc)
        db.add(models.UsageLog(
            company_id=job_rec.company_id, job_id=job_id,
            panels_count=panels_count, credits_used=1,
        ))
        db.commit()

        return {"ok": True, "job_id": job_id, "panels": panels_count}

    except Exception as exc:
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
