import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
import models

ALGORITHM   = "HS256"
TOKEN_HOURS = 24 * 7   # 7 giorni (durata cookie)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Letti dinamicamente ad ogni chiamata — robusti a reload uvicorn e dotenv tardivo
def _secret_key() -> str:
    return os.getenv("SECRET_KEY", "solardino-secret-change-in-production")

def _admin_email() -> str:
    return os.getenv("ADMIN_EMAIL", "admin@solardino.it")

# Alias usato dai router che importano auth_utils.ADMIN_EMAIL
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@solardino.it")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(data: dict) -> str:
    payload = data.copy()
    payload["exp"] = datetime.now(timezone.utc) + timedelta(hours=TOKEN_HOURS)
    return jwt.encode(payload, _secret_key(), algorithm=ALGORITHM)


def _decode_token(token: str):
    try:
        return jwt.decode(token, _secret_key(), algorithms=[ALGORITHM])
    except JWTError:
        return None


def _extract_token(request: Request) -> str | None:
    """Legge il token prima dal cookie HttpOnly, poi dall'header Authorization."""
    token = request.cookies.get("token")
    if token:
        return token
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return None


def get_current_company(
    request: Request,
    db: Session = Depends(get_db),
) -> models.Company:
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Non autenticato")

    payload = _decode_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Token non valido o scaduto")

    company = db.query(models.Company).filter(
        models.Company.id == int(payload.get("sub")),
        models.Company.deleted_at.is_(None),
    ).first()

    if not company or not company.is_active:
        raise HTTPException(status_code=401, detail="Account non trovato o disattivato")

    return company


def sync_credits_by_vat(db: Session, vat_number: str, new_credits: int) -> None:
    """Allinea i crediti di tutti gli account con la stessa Partita IVA."""
    if not vat_number:
        return
    db.query(models.Company).filter(
        models.Company.vat_number == vat_number,
        models.Company.deleted_at.is_(None),
    ).update({"credits": new_credits})


def require_admin(
    company: models.Company = Depends(get_current_company),
) -> models.Company:
    if company.email != _admin_email():
        raise HTTPException(status_code=403, detail="Accesso riservato all'amministratore")
    return company
