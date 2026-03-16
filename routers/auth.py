from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth_utils
import models
from database import get_db

router = APIRouter(prefix="/auth", tags=["Auth"])

# Domini email personali/gratuiti — per questi si controlla solo l'email esatta
_FREE_DOMAINS = {
    "gmail.com","yahoo.com","hotmail.com","outlook.com","live.com",
    "icloud.com","me.com","libero.it","virgilio.it","tiscali.it",
    "alice.it","tin.it","yahoo.it","fastwebnet.it","msn.com",
}

def _domain(email: str) -> str:
    return email.split("@")[-1].lower()


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email:           str
    name:            str
    ragione_sociale: str
    vat_number:      str   # Partita IVA
    password:        str


@router.post("/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    email  = req.email.lower().strip()
    domain = _domain(email)

    vat    = req.vat_number.strip().upper().replace(" ", "")
    rs     = req.ragione_sociale.strip()

    if not vat:
        raise HTTPException(status_code=400, detail="Partita IVA obbligatoria")
    if not rs:
        raise HTTPException(status_code=400, detail="Ragione sociale obbligatoria")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="La password deve avere almeno 8 caratteri")

    # Controllo P.IVA — se esiste ma è soft-deleted, riattiva senza bonus
    deleted_company = db.query(models.Company).filter(
        models.Company.vat_number == vat,
        models.Company.deleted_at.isnot(None),
    ).first()

    if deleted_company:
        # Controlla che la nuova email non sia già usata da qualcun altro
        email_conflict = db.query(models.Company).filter(
            models.Company.email == email,
            models.Company.id != deleted_company.id,
            models.Company.deleted_at.is_(None),
        ).first()
        if email_conflict:
            raise HTTPException(status_code=400, detail="Email già registrata da un altro account")

        # Riattiva senza bonus crediti
        deleted_company.email           = email
        deleted_company.name            = req.name.strip()
        deleted_company.ragione_sociale = rs
        deleted_company.password_hash   = auth_utils.hash_password(req.password)
        deleted_company.is_active       = True
        deleted_company.deleted_at      = None
        # credits invariati (no bonus)
        db.commit()
        db.refresh(deleted_company)

        token = auth_utils.create_token({"sub": str(deleted_company.id)})
        return {
            "access_token": token,
            "token_type":   "bearer",
            "name":         deleted_company.name,
            "email":        deleted_company.email,
            "credits":      deleted_company.credits,
            "is_admin":     False,
        }

    # Controllo P.IVA attiva (non deleted)
    if db.query(models.Company).filter(
        models.Company.vat_number == vat,
        models.Company.deleted_at.is_(None)
    ).first():
        raise HTTPException(
            status_code=400,
            detail="Questa Partita IVA è già registrata. Contatta l'amministratore per accedere al tuo account."
        )

    # Controllo email esatta (escludi soft-deleted)
    if db.query(models.Company).filter(
        models.Company.email == email,
        models.Company.deleted_at.is_(None)
    ).first():
        raise HTTPException(status_code=400, detail="Email già registrata")

    # Controllo dominio aziendale come fallback
    if domain not in _FREE_DOMAINS:
        if db.query(models.Company).filter(
            models.Company.email.like(f"%@{domain}"),
            models.Company.deleted_at.is_(None)
        ).first():
            raise HTTPException(
                status_code=400,
                detail=f"Un account con dominio @{domain} esiste già. Contatta l'amministratore."
            )

    company = models.Company(
        email           = email,
        name            = req.name.strip(),
        ragione_sociale = rs,
        vat_number      = vat,
        password_hash   = auth_utils.hash_password(req.password),
        credits         = 1,
        is_active       = True,
    )
    db.add(company)
    db.commit()
    db.refresh(company)

    token = auth_utils.create_token({"sub": str(company.id)})
    return {
        "access_token": token,
        "token_type":   "bearer",
        "name":         company.name,
        "email":        company.email,
        "credits":      company.credits,
        "is_admin":     False,
    }


@router.post("/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    company = db.query(models.Company).filter(
        models.Company.email == req.email.lower().strip()
    ).first()

    if not company or not auth_utils.verify_password(req.password, company.password_hash):
        raise HTTPException(status_code=401, detail="Email o password errati")

    if not company.is_active:
        raise HTTPException(status_code=403, detail="Account disattivato. Contatta l'amministratore.")

    token = auth_utils.create_token({"sub": str(company.id)})
    return {
        "access_token": token,
        "token_type": "bearer",
        "name": company.name,
        "email": company.email,
        "credits": company.credits,
        "is_admin": company.email == auth_utils.ADMIN_EMAIL,
    }


@router.get("/me")
def me(current: models.Company = Depends(auth_utils.get_current_company)):
    return {
        "id": current.id,
        "email": current.email,
        "name": current.name,
        "credits": current.credits,
        "is_admin": current.email == auth_utils.ADMIN_EMAIL,
        "created_at": current.created_at.isoformat(),
    }


@router.post("/change-password")
def change_password(
    body: dict,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    old = body.get("old_password", "")
    new = body.get("new_password", "")

    if not auth_utils.verify_password(old, current.password_hash):
        raise HTTPException(status_code=400, detail="Password attuale errata")

    if len(new) < 8:
        raise HTTPException(status_code=400, detail="La nuova password deve avere almeno 8 caratteri")

    current.password_hash = auth_utils.hash_password(new)
    db.commit()
    return {"message": "Password aggiornata con successo"}
