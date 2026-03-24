import os
import asyncio
from contextlib import asynccontextmanager
from dotenv import load_dotenv
load_dotenv(override=True)  # carica .env e sovrascrive variabili già esistenti

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

import auth_utils
import models
import storage_utils
from sqlalchemy import text
from database import Base, SessionLocal, engine, run_migrations
from routers import admin, auth, flighthub, missions, payments, reviews


def _run_migrations_background():
    """Esegue migrazioni DB in background — non blocca lo startup."""
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        print(f"[MIGRATION] create_all: {e}")

    try:
        run_migrations(engine)
    except Exception as e:
        print(f"[MIGRATION] run_migrations: {e}")

    migrations = [
        "ALTER TABLE companies ADD COLUMN ragione_sociale VARCHAR",
        "ALTER TABLE companies ADD COLUMN vat_number VARCHAR",
        "ALTER TABLE companies ADD COLUMN deleted_at TIMESTAMP",
        "ALTER TABLE companies ADD COLUMN last_ip VARCHAR",
        "ALTER TABLE companies ADD COLUMN pec VARCHAR",
        "ALTER TABLE companies ADD COLUMN welcome_bonus_used BOOLEAN DEFAULT FALSE",
        "ALTER TABLE companies ADD COLUMN last_login_at TIMESTAMP",
        "ALTER TABLE jobs ADD COLUMN panel_model VARCHAR",
        "ALTER TABLE jobs ADD COLUMN panel_dimensions VARCHAR",
        "ALTER TABLE jobs ADD COLUMN panel_efficiency FLOAT",
        "ALTER TABLE jobs ADD COLUMN panel_temp_coeff FLOAT",
        "CREATE TABLE IF NOT EXISTS reviews (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id), stars INTEGER NOT NULL, comment TEXT, status VARCHAR DEFAULT 'pending', created_at TIMESTAMP DEFAULT NOW())",
        "ALTER TABLE flighthub_connections ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP",
        "ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_email_key",
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_email_vat ON companies (email, vat_number) WHERE deleted_at IS NULL",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_manager BOOLEAN DEFAULT FALSE",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'aperto'",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS reply TEXT",
        "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS replied_at TIMESTAMP",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_active BOOLEAN DEFAULT FALSE",
        "CREATE TABLE IF NOT EXISTS ticket_messages (id SERIAL PRIMARY KEY, ticket_id INTEGER REFERENCES support_tickets(id) ON DELETE CASCADE, sender VARCHAR NOT NULL, text TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())",
    ]
    with engine.connect() as conn:
        for sql in migrations:
            try:
                conn.execute(text(sql))
                conn.commit()
            except Exception:
                conn.rollback()

    # Crea l'utente admin se non esiste
    db = SessionLocal()
    try:
        admin_email    = os.getenv("ADMIN_EMAIL",    "admin@solardino.it")
        admin_password = os.getenv("ADMIN_PASSWORD", "changeme123")
        existing_admin = db.query(models.Company).filter(models.Company.email == admin_email).first()
        if not existing_admin:
            db.add(models.Company(
                email=admin_email, name="Admin",
                password_hash=auth_utils.hash_password(admin_password),
                credits=9999, is_active=True, is_admin=True,
            ))
            db.commit()
            print(f"[MIGRATION] Admin creato: {admin_email}")
        else:
            if not existing_admin.is_admin:
                existing_admin.is_admin = True
                db.commit()
            print(f"[MIGRATION] Admin esistente: {admin_email}")
    finally:
        db.close()

    print("[MIGRATION] Completate.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Migrazioni in background — il server parte subito
    asyncio.get_event_loop().run_in_executor(None, _run_migrations_background)
    yield


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
app.include_router(reviews.router)
app.include_router(flighthub.router)

# Serve old static files (admin.html, etc.)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Serve React app (built frontend)
if os.path.isdir("static/app"):
    app.mount("/app", StaticFiles(directory="static/app", html=True), name="app")

if os.path.isdir("static/app/assets"):
    app.mount("/assets", StaticFiles(directory="static/app/assets"), name="app-assets")

@app.get("/", include_in_schema=False)
def root():
    if os.path.isfile("static/app/index.html"):
        return FileResponse("static/app/index.html")
    return RedirectResponse(url="/static/login.html")

@app.get("/login", include_in_schema=False)
@app.get("/register", include_in_schema=False)
@app.get("/dashboard", include_in_schema=False)
@app.get("/admin", include_in_schema=False)
def spa_routes():
    return FileResponse("static/app/index.html")




PRESENTATION_VIDEO_PATH = os.getenv("PRESENTATION_VIDEO_PATH", "")

@app.get("/api/presentation-video")
def get_presentation_video():
    """Ritorna l'URL firmato del video di presentazione da Supabase."""
    if not PRESENTATION_VIDEO_PATH:
        return {"url": None}
    try:
        url = storage_utils.get_signed_url(PRESENTATION_VIDEO_PATH, expires_in=86400)
        return {"url": url}
    except Exception:
        return {"url": None}


@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(content=b"", media_type="image/x-icon")

@app.get("/{full_path:path}", include_in_schema=False)
def spa_catch_all(full_path: str):
    return FileResponse("static/app/index.html")


@app.get("/health")
def health():
    return {"status": "ok", "service": "SolarDino API v2"}
