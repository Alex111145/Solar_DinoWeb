import os
import urllib.request
from contextlib import asynccontextmanager
from dotenv import load_dotenv
load_dotenv(override=True)  # carica .env e sovrascrive variabili già esistenti

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles

import auth_utils
import models
from sqlalchemy import text
from database import Base, SessionLocal, engine, run_migrations
from routers import admin, auth, flighthub, missions, payments, reviews


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Crea tutte le tabelle del database
    Base.metadata.create_all(bind=engine)

    # Migrazione nuove colonne (subscription_cancelled, welcome_bonus_requested, welcome_bonus_requests)
    run_migrations(engine)

    # Migrazione: aggiungi nuove colonne se non esistono (SQLite non supporta IF NOT EXISTS)
    with engine.connect() as conn:
        for col_sql in [
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
            # FlightHub 2 tables (idempotenti — create_all le crea, le ALTER sono no-op se esistono)
            "ALTER TABLE flighthub_connections ADD COLUMN IF NOT EXISTS last_sync_at TIMESTAMP",
            # Permetti email duplicate tra aziende diverse: rimuovi unique su email, aggiungi composite su (email, vat_number)
            "ALTER TABLE companies DROP CONSTRAINT IF EXISTS companies_email_key",
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_email_vat ON companies (email, vat_number) WHERE deleted_at IS NULL",
            # Nuove colonne manager/slave e ticket status
            "ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_manager BOOLEAN DEFAULT FALSE",
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS status VARCHAR DEFAULT 'aperto'",
            # Nuove colonne sessione 3-4
            "ALTER TABLE companies ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT FALSE",
            "ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE",
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS reply TEXT",
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS replied_at TIMESTAMP",
            "ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_active BOOLEAN DEFAULT FALSE",
            # Tabella messaggi ticket (sistema conversazione)
            "CREATE TABLE IF NOT EXISTS ticket_messages (id SERIAL PRIMARY KEY, ticket_id INTEGER REFERENCES support_tickets(id) ON DELETE CASCADE, sender VARCHAR NOT NULL, text TEXT NOT NULL, created_at TIMESTAMP DEFAULT NOW())",
        ]:
            try:
                conn.execute(text(col_sql))
                conn.commit()
            except Exception:
                conn.rollback()  # reset transazione abortita (necessario su PostgreSQL)

    # Crea l'utente admin se non esiste
    db = SessionLocal()
    try:
        admin_email    = os.getenv("ADMIN_EMAIL",    "admin@solardino.it")
        admin_password = os.getenv("ADMIN_PASSWORD", "changeme123")

        existing_admin = db.query(models.Company).filter(models.Company.email == admin_email).first()
        if not existing_admin:
            admin_user = models.Company(
                email         = admin_email,
                name          = "Admin",
                password_hash = auth_utils.hash_password(admin_password),
                credits       = 9999,
                is_active     = True,
                is_admin      = True,
            )
            db.add(admin_user)
            db.commit()
            print(f"[STARTUP] Admin creato: {admin_email}")
        else:
            # Assicura is_admin=True su account esistente (migrazione)
            if not existing_admin.is_admin:
                existing_admin.is_admin = True
                db.commit()
            print(f"[STARTUP] Admin esistente: {admin_email}")
    finally:
        db.close()

    # Scarica model_best.pth dal URL configurato (solo se non già presente su disco)
    model_url = os.getenv("MODEL_PTH_URL", "")
    upload_dir = os.getenv("UPLOAD_DIR", "elaborazioni")
    model_path = os.path.join(upload_dir, "model_best.pth")
    try:
        if model_url and not os.path.exists(model_path):
            print(f"[STARTUP] Download model_best.pth → {model_path} ...")
            os.makedirs(upload_dir, exist_ok=True)
            urllib.request.urlretrieve(model_url, model_path)
            print(f"[STARTUP] Modello scaricato ({os.path.getsize(model_path) // 1024 // 1024} MB)")
        elif os.path.exists(model_path):
            print(f"[STARTUP] Modello già presente: {model_path}")
        else:
            print("[STARTUP] MODEL_PTH_URL non configurato — modello non scaricato")
    except Exception as e:
        print(f"[STARTUP] Download modello fallito (non bloccante): {e}")

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
app.include_router(reviews.router)
app.include_router(flighthub.router)

# Serve old static files (admin.html, etc.)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Serve React app (built frontend)
if os.path.isdir("static/app"):
    app.mount("/app", StaticFiles(directory="static/app", html=True), name="app")

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




@app.get("/favicon.ico", include_in_schema=False)
def favicon():
    return Response(content=b"", media_type="image/x-icon")


@app.get("/health")
def health():
    return {"status": "ok", "service": "SolarDino API v2"}
