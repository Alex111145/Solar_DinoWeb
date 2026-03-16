import os
import urllib.request
from contextlib import asynccontextmanager
from dotenv import load_dotenv
load_dotenv(override=True)  # carica .env e sovrascrive variabili già esistenti

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

import auth_utils
import models
from sqlalchemy import text
from database import Base, SessionLocal, engine
from routers import admin, auth, missions, payments


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Crea tutte le tabelle del database
    Base.metadata.create_all(bind=engine)

    # Migrazione: aggiungi nuove colonne se non esistono (SQLite non supporta IF NOT EXISTS)
    with engine.connect() as conn:
        for col_sql in [
            "ALTER TABLE companies ADD COLUMN ragione_sociale VARCHAR",
            "ALTER TABLE companies ADD COLUMN vat_number VARCHAR",
            "ALTER TABLE companies ADD COLUMN deleted_at TIMESTAMP",
            "ALTER TABLE companies ADD COLUMN last_ip VARCHAR",
        ]:
            try:
                conn.execute(text(col_sql))
                conn.commit()
            except Exception:
                pass  # colonna già esistente

    # Crea l'utente admin se non esiste
    db = SessionLocal()
    try:
        admin_email    = os.getenv("ADMIN_EMAIL",    "admin@solardino.it")
        admin_password = os.getenv("ADMIN_PASSWORD", "changeme123")

        if not db.query(models.Company).filter(models.Company.email == admin_email).first():
            admin_user = models.Company(
                email         = admin_email,
                name          = "Admin — SolarDino",
                password_hash = auth_utils.hash_password(admin_password),
                credits       = 9999,
                is_active     = True,
            )
            db.add(admin_user)
            db.commit()
            print(f"[STARTUP] Admin creato: {admin_email}")
        else:
            print(f"[STARTUP] Admin esistente: {admin_email}")
    finally:
        db.close()

    # Scarica model_best.pth dal URL configurato (solo se non già presente su disco)
    model_url = os.getenv("MODEL_PTH_URL", "")
    upload_dir = os.getenv("UPLOAD_DIR", "elaborazioni")
    model_path = os.path.join(upload_dir, "model_best.pth")
    if model_url and not os.path.exists(model_path):
        print(f"[STARTUP] Download model_best.pth → {model_path} ...")
        os.makedirs(upload_dir, exist_ok=True)
        urllib.request.urlretrieve(model_url, model_path)
        print(f"[STARTUP] Modello scaricato ({os.path.getsize(model_path) // 1024 // 1024} MB)")
    elif os.path.exists(model_path):
        print(f"[STARTUP] Modello già presente: {model_path}")
    else:
        print("[STARTUP] MODEL_PTH_URL non configurato — modello non scaricato")

    yield  # server running


app = FastAPI(
    title       = "SolarDino API",
    description = "Backend AI per il rilevamento e l'analisi di pannelli solari tramite MaskDINO",
    version     = "2.0.0",
    lifespan    = lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins     = ["*"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

# API routes
app.include_router(auth.router)
app.include_router(missions.router)
app.include_router(admin.router)
app.include_router(payments.router)

# Serve frontend HTML/CSS/JS
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/static/login.html")


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(content=b"", media_type="image/x-icon")


@app.get("/health")
def health():
    return {"status": "ok", "service": "SolarDino API v2"}
