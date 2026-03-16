import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from database import get_db
import models

ALGORITHM   = "HS256"
TOKEN_HOURS = 24

pwd_context   = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer()

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


def get_current_company(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> models.Company:
    payload = _decode_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Token non valido o scaduto")

    company = db.query(models.Company).filter(
        models.Company.id == int(payload.get("sub")),
        models.Company.deleted_at.is_(None),
    ).first()

    if not company or not company.is_active:
        raise HTTPException(status_code=401, detail="Account non trovato o disattivato")

    return company


def require_admin(
    company: models.Company = Depends(get_current_company),
) -> models.Company:
    if company.email != _admin_email():
        raise HTTPException(status_code=403, detail="Accesso riservato all'amministratore")
    return company
