import os
from contextlib import asynccontextmanager
from dotenv import load_dotenv
load_dotenv(override=True)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

import auth_utils
import models
import storage_utils
from database import SessionLocal
from routers import admin, auth, flighthub, missions, payments, reviews


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Assicura che l'admin esista
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
            print(f"[STARTUP] Admin creato: {admin_email}")
        else:
            print(f"[STARTUP] Admin esistente: {admin_email}")
    except Exception as e:
        print(f"[STARTUP] Admin check fallito (non bloccante): {e}")
    finally:
        db.close()
    yield


app = FastAPI(
    title       = "SolarDino API",
    description = "Backend AI per il rilevamento e l'analisi di pannelli solari tramite MaskDINO",
    version     = "2.0.0",
    lifespan    = lifespan,
)

_ALLOWED_ORIGINS = [
    "https://solar-dinoweb.fly.dev",
    "http://localhost:5173",
    "http://localhost:8000",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins     = _ALLOWED_ORIGINS,
    allow_credentials = True,
    allow_methods     = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers     = ["Content-Type", "Authorization", "stripe-signature"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"]        = "DENY"
        response.headers["X-XSS-Protection"]       = "1; mode=block"
        response.headers["Referrer-Policy"]        = "strict-origin-when-cross-origin"
        return response

app.add_middleware(SecurityHeadersMiddleware)

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
