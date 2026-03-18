"""
DJI FlightHub 2 — Enterprise Integration (Strada B)
=====================================================
Flusso automatico:
  1. L'azienda connette il suo account FlightHub 2 (workspace_id + credenziali OAuth2).
  2. Quando DJI completa un ortomosaico, invia un webhook a POST /flighthub/webhook
     OPPURE l'admin/sistema chiama POST /flighthub/sync per polling manuale.
  3. Il sistema scarica il TIF da DJI, esegue l'inferenza AI, carica i risultati (KML)
     su FlightHub 2 come layer personalizzato sulla mappa.
  4. Il cliente vede i pannelli guasti direttamente in FlightHub 2, senza fare nulla.

Variabili d'ambiente:
  FLIGHTHUB_API_URL   — base URL API DJI (default: https://openapi.dji.com)
  FLIGHTHUB_API_VER   — versione API (default: v2)
  UPLOAD_DIR          — directory locale per file temporanei
"""

import hashlib
import hmac
import json
import os
import shutil
import sys
import tempfile
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth_utils
import models
from database import get_db

router = APIRouter(prefix="/flighthub", tags=["FlightHub 2"])

# ── Configurazione ───────────────────────────────────────────────────────────
FH_API        = os.getenv("FLIGHTHUB_API_URL", "https://openapi.dji.com")
FH_VER        = os.getenv("FLIGHTHUB_API_VER", "v2")
UPLOAD_DIR    = os.getenv("UPLOAD_DIR", "elaborazioni")
CORE_SCRIPT   = os.path.join(
    os.path.dirname(os.path.dirname(__file__)), "core", "inferenzanuovosito_cli.py"
)
# Segreto webhook condiviso con DJI (configurabile nel portale DJI)
WEBHOOK_SECRET = os.getenv("FLIGHTHUB_WEBHOOK_SECRET", "")


# ── Schemi Pydantic ──────────────────────────────────────────────────────────

class ConnectBody(BaseModel):
    workspace_id:  str
    client_id:     str
    client_secret: str


# ── Helpers DJI API ──────────────────────────────────────────────────────────

def _fh_url(path: str) -> str:
    return f"{FH_API}/{FH_VER}/{path.lstrip('/')}"


def _get_access_token(conn: models.FlightHubConnection, db: Session) -> str:
    """
    Restituisce un access token valido, aggiornandolo se scaduto.
    DJI OAuth2 Client Credentials Flow.
    Ref: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/
    """
    now = datetime.now(timezone.utc)
    if conn.access_token and conn.token_expires and conn.token_expires > now + timedelta(minutes=5):
        return conn.access_token

    data = urllib.parse.urlencode({
        "grant_type":    "client_credentials",
        "client_id":     conn.client_id,
        "client_secret": conn.client_secret,
    }).encode()

    req = urllib.request.Request(
        f"{FH_API}/oauth/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            body = json.loads(resp.read())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DJI auth fallita: {e}")

    token      = body.get("access_token") or body.get("data", {}).get("access_token")
    expires_in = body.get("expires_in", 7200)

    if not token:
        raise HTTPException(status_code=502, detail=f"DJI: nessun access_token nella risposta: {body}")

    conn.access_token  = token
    conn.token_expires = now + timedelta(seconds=int(expires_in))
    db.commit()
    return token


def _dji_get(url: str, token: str) -> dict:
    req = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DJI API GET fallita [{url}]: {e}")


def _dji_post(url: str, token: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    req  = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization":  f"Bearer {token}",
            "Content-Type":   "application/json",
            "Accept":         "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return json.loads(resp.read())
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"DJI API POST fallita [{url}]: {e}")


def _list_maps(token: str, workspace_id: str) -> list[dict]:
    """
    Elenca le mappe ortomosaico disponibili nel workspace.
    Endpoint: GET /v2/workspaces/{workspace_id}/maps
    Ref: https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/map-management/
    """
    url  = _fh_url(f"workspaces/{workspace_id}/maps")
    body = _dji_get(url, token)
    # DJI restituisce {code, data: {list: [...], total: N}}
    return body.get("data", {}).get("list", body.get("data", []))


def _get_map_download_url(token: str, workspace_id: str, map_id: str) -> str:
    """
    Ottiene l'URL firmato per scaricare il TIF dell'ortomosaico.
    Endpoint: GET /v2/workspaces/{workspace_id}/maps/{map_id}/download
    """
    url  = _fh_url(f"workspaces/{workspace_id}/maps/{map_id}/download")
    body = _dji_get(url, token)
    download_url = (
        body.get("data", {}).get("url")
        or body.get("data", {}).get("download_url")
        or body.get("url")
    )
    if not download_url:
        raise HTTPException(status_code=502, detail=f"DJI: URL download non trovato nella risposta: {body}")
    return download_url


def _upload_kml_to_flighthub(
    token: str, workspace_id: str, map_id: str, kml_path: str, map_name: str
) -> bool:
    """
    Carica il KML dei risultati come elemento/layer su FlightHub 2.
    Endpoint: POST /v2/workspaces/{workspace_id}/elements
    Il layer appare sulla mappa in FlightHub 2 con i pannelli guasti evidenziati.
    """
    if not os.path.isfile(kml_path):
        return False

    with open(kml_path, "r", encoding="utf-8") as f:
        kml_content = f.read()

    payload = {
        "name":        f"SolarDino AI — {map_name}",
        "map_id":      map_id,
        "type":        "kml",
        "content":     kml_content,
        "description": "Rilevamento pannelli solari difettosi — SolarDino AI",
    }
    url = _fh_url(f"workspaces/{workspace_id}/elements")
    try:
        _dji_post(url, token, payload)
        return True
    except Exception:
        return False


# ── Pipeline background ──────────────────────────────────────────────────────

def _run_flighthub_pipeline(fh_job_id: int):
    """
    Pipeline completo per un FlightHubJob:
      1. Scarica il TIF da DJI
      2. Esegue l'inferenza AI (stesso script di Strada A)
      3. Carica il KML su FlightHub 2
    """
    from database import DATABASE_URL
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    import subprocess

    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    )
    Sess = sessionmaker(bind=engine)
    db   = Sess()

    try:
        fh_job = db.query(models.FlightHubJob).filter(models.FlightHubJob.id == fh_job_id).first()
        if not fh_job:
            return

        conn = db.query(models.FlightHubConnection).filter(
            models.FlightHubConnection.company_id == fh_job.company_id
        ).first()
        if not conn:
            fh_job.status    = "error"
            fh_job.error_msg = "Connessione FlightHub non trovata"
            db.commit()
            return

        company = db.query(models.Company).filter(models.Company.id == fh_job.company_id).first()
        if not company or company.credits <= 0:
            fh_job.status    = "error"
            fh_job.error_msg = "Crediti insufficienti"
            db.commit()
            return

        # ── Step 1: download TIF ─────────────────────────────────────────
        fh_job.status = "downloading"
        db.commit()

        token        = _get_access_token(conn, db)
        download_url = _get_map_download_url(token, conn.workspace_id, fh_job.fh_map_id)

        job_id  = str(uuid.uuid4())
        job_dir = os.path.join(UPLOAD_DIR, job_id)
        os.makedirs(job_dir, exist_ok=True)

        tif_filename = f"fh_{fh_job.fh_map_id}.tif"
        tif_path     = os.path.join(job_dir, tif_filename)

        req = urllib.request.Request(download_url, headers={"Authorization": f"Bearer {token}"})
        with urllib.request.urlopen(req, timeout=300) as resp, open(tif_path, "wb") as f:
            shutil.copyfileobj(resp, f)

        # ── Step 2: crea Job interno e scala credito ─────────────────────
        fh_job.status = "processing"
        db.commit()

        company.credits -= 1
        job = models.Job(
            id           = job_id,
            company_id   = fh_job.company_id,
            status       = "taglio_tile",
            tif_filename = tif_filename,
        )
        db.add(job)
        fh_job.job_id = job_id
        db.commit()

        # TFW: opzionale — se non esiste passiamo una stringa vuota
        tfw_path = os.path.join(job_dir, f"fh_{fh_job.fh_map_id}.tfw")
        if not os.path.isfile(tfw_path):
            tfw_path = ""

        model_dir = UPLOAD_DIR
        cmd = [sys.executable, CORE_SCRIPT, "--tif", tif_path, "--outdir", job_dir, "--weights", model_dir]
        if tfw_path:
            cmd += ["--tfw", tfw_path]

        result = subprocess.run(cmd, capture_output=True, text=True)

        job = db.query(models.Job).filter(models.Job.id == job_id).first()

        if result.returncode != 0:
            job.status       = "errore"
            job.log          = (result.stderr or result.stdout or "Errore")[-6000:]
            fh_job.status    = "error"
            fh_job.error_msg = job.log[:500]
            db.commit()
            return

        # Parse results
        panels_count  = 0
        hotspot_count = 0
        degraded      = 0
        output_json   = os.path.join(job_dir, "Rilevamenti_Pannelli.json")
        if os.path.exists(output_json):
            try:
                with open(output_json) as f:
                    data = json.load(f)
                pannelli      = data.get("pannelli", [])
                panels_count  = len(pannelli)
                hotspot_count = sum(1 for p in pannelli if p.get("class_id") == 1)
                degraded      = sum(1 for p in pannelli if p.get("class_id") == 2)
            except Exception:
                pass

        job.status          = "completato"
        job.result_path     = job_dir
        job.panels_detected = panels_count
        job.hotspot_count   = hotspot_count
        job.degraded_count  = degraded
        job.log             = (result.stdout or "")[-3000:]
        job.completed_at    = datetime.now(timezone.utc)

        usage = models.UsageLog(
            company_id   = fh_job.company_id,
            job_id       = job_id,
            panels_count = panels_count,
            credits_used = 1,
        )
        db.add(usage)
        db.commit()

        # ── Step 3: carica risultati su FlightHub 2 ──────────────────────
        fh_job.status = "uploading"
        db.commit()

        kml_path = os.path.join(job_dir, "Mappa_Pannelli.kml")
        token    = _get_access_token(conn, db)  # rinnova se necessario
        ok       = _upload_kml_to_flighthub(
            token, conn.workspace_id, fh_job.fh_map_id, kml_path,
            fh_job.fh_map_name or fh_job.fh_map_id
        )

        fh_job.status           = "done"
        fh_job.results_uploaded = ok
        fh_job.completed_at     = datetime.now(timezone.utc)
        db.commit()

    except Exception as exc:
        try:
            fh_job = db.query(models.FlightHubJob).filter(models.FlightHubJob.id == fh_job_id).first()
            if fh_job:
                fh_job.status    = "error"
                fh_job.error_msg = str(exc)[:1000]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get("/status")
def get_status(
    current: models.Company = Depends(auth_utils.get_current_company),
    db:      Session         = Depends(get_db),
):
    """Restituisce lo stato della connessione FlightHub 2 per l'azienda corrente."""
    conn = db.query(models.FlightHubConnection).filter(
        models.FlightHubConnection.company_id == current.id
    ).first()

    if not conn:
        return {"connected": False}

    fh_jobs = (
        db.query(models.FlightHubJob)
        .filter(models.FlightHubJob.company_id == current.id)
        .order_by(models.FlightHubJob.created_at.desc())
        .limit(20)
        .all()
    )

    return {
        "connected":    True,
        "workspace_id": conn.workspace_id,
        "last_sync_at": conn.last_sync_at.isoformat() if conn.last_sync_at else None,
        "missions": [
            {
                "id":               fj.id,
                "fh_map_id":        fj.fh_map_id,
                "fh_map_name":      fj.fh_map_name,
                "status":           fj.status,
                "results_uploaded": fj.results_uploaded,
                "panels_detected":  fj.job.panels_detected if fj.job else None,
                "hotspot_count":    fj.job.hotspot_count   if fj.job else None,
                "error_msg":        fj.error_msg,
                "created_at":       fj.created_at.isoformat(),
                "completed_at":     fj.completed_at.isoformat() if fj.completed_at else None,
            }
            for fj in fh_jobs
        ],
    }


@router.post("/connect")
def connect(
    body:    ConnectBody,
    current: models.Company = Depends(auth_utils.get_current_company),
    db:      Session         = Depends(get_db),
):
    """
    Salva le credenziali DJI FlightHub 2 e verifica la connessione.
    Richiede workspace_id, client_id, client_secret del portale DJI Developer.
    """
    # Rimuovi connessione precedente se esiste
    existing = db.query(models.FlightHubConnection).filter(
        models.FlightHubConnection.company_id == current.id
    ).first()
    if existing:
        db.delete(existing)
        db.commit()

    conn = models.FlightHubConnection(
        company_id    = current.id,
        workspace_id  = body.workspace_id.strip(),
        client_id     = body.client_id.strip(),
        client_secret = body.client_secret.strip(),
    )
    db.add(conn)
    db.commit()
    db.refresh(conn)

    # Test connessione: ottieni token
    try:
        _get_access_token(conn, db)
    except HTTPException as e:
        db.delete(conn)
        db.commit()
        raise HTTPException(status_code=400, detail=f"Connessione fallita: {e.detail}")

    return {"message": "Connesso a FlightHub 2 con successo", "workspace_id": conn.workspace_id}


@router.delete("/disconnect")
def disconnect(
    current: models.Company = Depends(auth_utils.get_current_company),
    db:      Session         = Depends(get_db),
):
    conn = db.query(models.FlightHubConnection).filter(
        models.FlightHubConnection.company_id == current.id
    ).first()
    if conn:
        db.delete(conn)
        db.commit()
    return {"message": "Disconnesso da FlightHub 2"}


@router.post("/sync")
def sync_missions(
    background_tasks: BackgroundTasks,
    current: models.Company = Depends(auth_utils.get_current_company),
    db:      Session         = Depends(get_db),
):
    """
    Controlla se ci sono nuove mappe su FlightHub 2 dall'ultima sincronizzazione
    e avvia l'elaborazione per quelle nuove.
    """
    conn = db.query(models.FlightHubConnection).filter(
        models.FlightHubConnection.company_id == current.id
    ).first()
    if not conn:
        raise HTTPException(status_code=400, detail="Nessuna connessione FlightHub 2 configurata")

    if current.credits <= 0:
        raise HTTPException(status_code=402, detail="Crediti insufficienti per elaborare nuove mappe")

    token = _get_access_token(conn, db)
    maps  = _list_maps(token, conn.workspace_id)

    # IDs già processati
    processed_ids = {
        fj.fh_map_id
        for fj in db.query(models.FlightHubJob)
        .filter(models.FlightHubJob.company_id == current.id)
        .all()
    }

    queued = 0
    for m in maps:
        map_id   = str(m.get("id") or m.get("map_id") or "")
        map_name = m.get("name") or m.get("title") or map_id
        mission_id = str(m.get("mission_id") or m.get("task_id") or map_id)

        if not map_id or map_id in processed_ids:
            continue

        fh_job = models.FlightHubJob(
            company_id    = current.id,
            fh_mission_id = mission_id,
            fh_map_id     = map_id,
            fh_map_name   = map_name,
            status        = "pending",
        )
        db.add(fh_job)
        db.commit()
        db.refresh(fh_job)

        background_tasks.add_task(_run_flighthub_pipeline, fh_job.id)
        queued += 1

    conn.last_sync_at = datetime.now(timezone.utc)
    db.commit()

    return {
        "message":   f"Sync completato: {queued} nuove mappe in elaborazione",
        "new_maps":  queued,
        "total_maps": len(maps),
    }


@router.post("/webhook")
async def webhook(
    request: Request,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    x_dji_signature: Optional[str] = Header(None),
):
    """
    Webhook ricevuto da DJI FlightHub 2 quando una mappa è pronta.
    DJI invia una firma HMAC-SHA256 nell'header X-DJI-Signature.
    Configura questo URL nel portale DJI: POST /api/flighthub/webhook
    """
    body_bytes = await request.body()

    # Verifica firma se il segreto è configurato
    if WEBHOOK_SECRET and x_dji_signature:
        expected = hmac.new(
            WEBHOOK_SECRET.encode(), body_bytes, hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(expected, x_dji_signature.replace("sha256=", "")):
            raise HTTPException(status_code=401, detail="Firma webhook non valida")

    try:
        payload = json.loads(body_bytes)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Payload non valido")

    # Struttura evento DJI:
    # {"event": "map.completed", "workspace_id": "...", "map_id": "...",
    #  "mission_id": "...", "name": "..."}
    event        = payload.get("event", "")
    workspace_id = payload.get("workspace_id", "")
    map_id       = str(payload.get("map_id", ""))
    mission_id   = str(payload.get("mission_id") or map_id)
    map_name     = payload.get("name") or payload.get("title") or map_id

    # Accetta vari event type DJI
    accepted_events = {"map.completed", "orthomosaic.ready", "mission.completed", "map_ready"}
    if event and event not in accepted_events:
        return {"received": True, "processed": False, "reason": f"Evento ignorato: {event}"}

    if not workspace_id or not map_id:
        return {"received": True, "processed": False, "reason": "workspace_id o map_id mancanti"}

    # Trova la connessione associata al workspace
    conn = db.query(models.FlightHubConnection).filter(
        models.FlightHubConnection.workspace_id == workspace_id
    ).first()
    if not conn:
        return {"received": True, "processed": False, "reason": "Workspace non trovato"}

    # Evita duplicati
    exists = db.query(models.FlightHubJob).filter(
        models.FlightHubJob.company_id == conn.company_id,
        models.FlightHubJob.fh_map_id  == map_id,
    ).first()
    if exists:
        return {"received": True, "processed": False, "reason": "Mappa già in coda"}

    company = db.query(models.Company).filter(models.Company.id == conn.company_id).first()
    if not company or company.credits <= 0:
        return {"received": True, "processed": False, "reason": "Crediti insufficienti"}

    fh_job = models.FlightHubJob(
        company_id    = conn.company_id,
        fh_mission_id = mission_id,
        fh_map_id     = map_id,
        fh_map_name   = map_name,
        status        = "pending",
    )
    db.add(fh_job)
    db.commit()
    db.refresh(fh_job)

    background_tasks.add_task(_run_flighthub_pipeline, fh_job.id)

    return {"received": True, "processed": True, "fh_job_id": fh_job.id}


@router.get("/missions/{fh_job_id}/download/{file_type}")
def download_fh_result(
    fh_job_id: int,
    file_type: str,
    current: models.Company = Depends(auth_utils.get_current_company),
    db:       Session        = Depends(get_db),
):
    """Scarica i file risultato (kml/csv/json) di una missione FlightHub."""
    fh_job = db.query(models.FlightHubJob).filter(
        models.FlightHubJob.id         == fh_job_id,
        models.FlightHubJob.company_id == current.id,
    ).first()
    if not fh_job or not fh_job.job_id:
        raise HTTPException(status_code=404, detail="Missione non trovata")

    job = db.query(models.Job).filter(models.Job.id == fh_job.job_id).first()
    if not job or job.status != "completato":
        raise HTTPException(status_code=400, detail="Elaborazione non ancora completata")

    from fastapi.responses import FileResponse
    FILE_MAP = {
        "json":    ("Rilevamenti_Pannelli.json",    "application/json"),
        "csv":     ("Rilevamenti_Pannelli.csv",     "text/csv"),
        "kml":     ("Mappa_Pannelli.kml",           "application/vnd.google-earth.kml+xml"),
        "geojson": ("Rilevamenti_Pannelli.geojson", "application/geo+json"),
    }
    if file_type not in FILE_MAP:
        raise HTTPException(status_code=400, detail=f"Tipo non supportato: {', '.join(FILE_MAP)}")

    fname, media_type = FILE_MAP[file_type]
    path = os.path.join(job.result_path, fname)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="File non ancora disponibile")

    return FileResponse(path=path, filename=fname, media_type=media_type)


# ---------------------------------------------------------------------------
# Avvia Inferenza Enterprise — log consenso dati + trigger sync
# ---------------------------------------------------------------------------

@router.post("/avvia-inferenza")
def avvia_inferenza_enterprise(
    background_tasks: BackgroundTasks,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """
    Registra il consenso al riutilizzo dei dati per il retraining del modello
    e avvia la sincronizzazione FlightHub 2 (se connessa).
    """
    if not current.is_active:
        raise HTTPException(status_code=403, detail="Account disabilitato")

    # Recupera workspace_id se connesso
    conn = db.query(models.FlightHubConnection).filter(
        models.FlightHubConnection.company_id == current.id
    ).first()

    # Salva log consenso
    log = models.EnterpriseInferenceLog(
        company_id      = current.id,
        company_name    = current.ragione_sociale or current.name,
        company_email   = current.email,
        vat_number      = current.vat_number,
        fh_workspace_id = conn.workspace_id if conn else None,
        data_consent    = True,
    )
    db.add(log)
    db.commit()

    # Avvia sync FlightHub in background se connessa
    if conn:
        background_tasks.add_task(_trigger_fh_sync, current.id)
        return {"message": "Inferenza avviata. Sincronizzazione FlightHub in corso.", "syncing": True}

    return {"message": "Consenso registrato. Collega FlightHub 2 per avviare l'inferenza automatica.", "syncing": False}


def _trigger_fh_sync(company_id: int):
    """Background task: sincronizza FlightHub per l'azienda specificata."""
    from database import DATABASE_URL
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {},
    )
    Sess = sessionmaker(bind=engine)
    db   = Sess()
    try:
        conn = db.query(models.FlightHubConnection).filter(
            models.FlightHubConnection.company_id == company_id
        ).first()
        if not conn:
            return
        token = _get_access_token(conn, db)
        maps  = _dji_get(f"/workspaces/{conn.workspace_id}/maps", token)
        for m in (maps.get("data") or []):
            existing = db.query(models.FlightHubJob).filter(
                models.FlightHubJob.fh_map_id   == str(m.get("id")),
                models.FlightHubJob.company_id  == company_id,
            ).first()
            if not existing:
                fh_job = models.FlightHubJob(
                    company_id    = company_id,
                    fh_mission_id = str(m.get("mission_id") or ""),
                    fh_map_id     = str(m.get("id")),
                    fh_map_name   = m.get("name"),
                    status        = "pending",
                )
                db.add(fh_job)
                db.commit()
                db.refresh(fh_job)
                _run_flighthub_pipeline(fh_job.id, conn.workspace_id, token)
        conn.last_sync_at = datetime.now(timezone.utc)
        db.commit()
    except Exception:
        pass
    finally:
        db.close()
