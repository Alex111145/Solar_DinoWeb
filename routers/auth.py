import os
import secrets
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth_utils
import models
from database import get_db
from email_utils import send_email
import difflib
import json
import re
import urllib.request as _urllib

router = APIRouter(prefix="/auth", tags=["Auth"])

# Domini email personali/gratuiti — per questi si controlla solo l'email esatta
_FREE_DOMAINS = {
    "gmail.com","yahoo.com","hotmail.com","outlook.com","live.com",
    "icloud.com","me.com","libero.it","virgilio.it","tiscali.it",
    "alice.it","tin.it","yahoo.it","fastwebnet.it","msn.com",
}

def _domain(email: str) -> str:
    return email.split("@")[-1].lower()


# ── P.IVA checksum (algoritmo italiano) ─────────────────────────────────────

def _validate_piva_checksum(piva: str) -> bool:
    """Verifica il checksum della Partita IVA italiana (11 cifre)."""
    if not re.match(r'^\d{11}$', piva):
        return False
    digits = [int(d) for d in piva]
    s = 0
    for i in range(10):
        if i % 2 == 0:          # posizioni dispari (1,3,5,7,9) → somma diretta
            s += digits[i]
        else:                    # posizioni pari (2,4,6,8,10) → raddoppia, se ≥10 sottrai 9
            d = digits[i] * 2
            s += d if d < 10 else d - 9
    return (10 - s % 10) % 10 == digits[10]


# ── VIES API ─────────────────────────────────────────────────────────────────

def _verify_vies(piva: str) -> dict:
    """
    Interroga il servizio VIES EU per la P.IVA italiana.
    Ritorna {'valid': bool|None, 'name': str}
    None = API non raggiungibile (non bloccare la registrazione)
    Usa un thread separato con hard timeout di 5s per evitare blocchi.
    """
    import concurrent.futures

    def _call():
        url = f"https://ec.europa.eu/taxation_customs/vies/rest-api/ms/IT/vat/{piva}"
        req = _urllib.Request(url, headers={"Accept": "application/json", "User-Agent": "SolarDino/2.0"})
        with _urllib.urlopen(req, timeout=4) as resp:
            return json.loads(resp.read())

    try:
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as ex:
            future = ex.submit(_call)
            data = future.result(timeout=5)   # hard cutoff: 5 secondi totali
        return {
            "valid": bool(data.get("isValid", False)),
            "name":  (data.get("name") or "").strip(),
        }
    except concurrent.futures.TimeoutError:
        print("[VIES] Timeout hard (5s) — salto verifica")
        return {"valid": None, "name": ""}
    except Exception as exc:
        print(f"[VIES] Errore chiamata API: {exc}")
        return {"valid": None, "name": ""}


def _names_match(name_a: str, name_b: str, threshold: float = 0.55) -> bool:
    """Confronto fuzzy tra ragioni sociali, ignora forme giuridiche e punteggiatura."""
    _SUFFIXES = {
        "SRL", "S.R.L", "SPA", "S.P.A", "SNC", "S.N.C", "SAS", "S.A.S",
        "SRLS", "S.R.L.S", "SS", "S.S", "SOC", "COOP", "ARL", "SCARL",
        "SAP", "SC", "DI", "E", "&",
    }
    def normalize(n: str) -> str:
        n = re.sub(r'[^\w\s]', ' ', n.upper())
        words = [w for w in n.split() if w not in _SUFFIXES and len(w) > 1]
        return ' '.join(words)

    a = normalize(name_a)
    b = normalize(name_b)
    if not a or not b:
        return True   # se uno dei due è vuoto dopo normalizzazione, skip
    ratio = difflib.SequenceMatcher(None, a, b).ratio()
    print(f"[VIES] Fuzzy match '{a}' vs '{b}' → {ratio:.2f}")
    return ratio >= threshold


# ── PEC validation ───────────────────────────────────────────────────────────

_PEC_DOMAINS = {
    # Provider accreditati AgID principali
    "arubapec.it", "pec.aruba.it",
    "legalmail.it", "cert.legalmail.it",
    "pec.it",
    "postecert.it", "posta-certificata.it",
    "pecimprese.it",
    "namirial.it", "pec.namirial.it",
    "registerpec.it",
    "pecmail.it",
    "gigapec.it",
    "mypec.eu",
    "pec.cgn.it",
    "sicurpec.it",
    "agenziapec.it",
    "lex-mail.it",
    "pecaziendale.it",
    "lamiapec.it",
    "oneri.it",
    "pecservizi.it",
    "actaliscertymail.it",
    "pec.biz",
    "interlex.it",
    # Ordini professionali
    "pecavvocati.it",
    "conaf.it",
    "pec.commercialisti.it",
    "ingpec.eu",
    "pec.geometri.it",
    "pec.agrotecnici.it",
    "ordinearchitetti.it",
    # Telco / provider storici
    "pec.libero.it",
    "pec.tiscali.it",
    "pec.buffetti.it",
    "pectel.it",
    "pec.telecompost.it",
}


def _is_valid_pec(pec: str) -> bool:
    """
    Valida formato PEC:
    - email valida
    - dominio in lista provider AgID accreditati
      OPPURE dominio che inizia con 'pec.' o contiene '.pec.'
    """
    pec = pec.lower().strip()
    if not re.match(r'^[^\s@]+@[^\s@]+\.[a-z]{2,}$', pec):
        return False
    domain = pec.split("@")[-1]
    if domain in _PEC_DOMAINS:
        return True
    # Accetta pattern tipo username@pec.azienda.it o username@azienda.pec.it
    parts = domain.split(".")
    if parts[0] == "pec":
        return True
    if len(parts) > 2 and "pec" in parts[:-1]:
        return True
    return False


ADMIN_EMAIL_NOTIFY = os.getenv("ADMIN_EMAIL", "agervasini1@gmail.com")

def _notify_admin_new_company(company: "models.Company", tipo: str) -> None:
    """Invia email all'admin quando si registra una nuova azienda o dipendente."""
    html = f"""<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.13);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#f59e0b;font-size:20px;font-weight:700;">☀️ SolarDino</h1>
            <p style="margin:8px 0 0;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;">{tipo}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#fff;padding:36px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Ragione sociale</span><br>
                <strong style="color:#0f172a;font-size:15px;">{company.ragione_sociale or "—"}</strong>
              </td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Referente</span><br>
                <strong style="color:#0f172a;">{company.name}</strong>
              </td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Email</span><br>
                <strong style="color:#0f172a;">{company.email}</strong>
              </td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Partita IVA</span><br>
                <strong style="color:#0f172a;">{company.vat_number or "—"}</strong>
              </td></tr>
              <tr><td style="padding:10px 0;">
                <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">PEC</span><br>
                <strong style="color:#0f172a;">{company.pec or "—"}</strong>
              </td></tr>
            </table>
            <div style="margin-top:28px;text-align:center;">
              <a href="https://solar-dinoweb.onrender.com/admin"
                 style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#0f172a;font-weight:700;padding:13px 28px;border-radius:12px;text-decoration:none;font-size:14px;">
                Vai all'admin
              </a>
            </div>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""
    send_email(ADMIN_EMAIL_NOTIFY, f"SolarDino — {tipo}: {company.ragione_sociale or company.name}", html)


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email:           str
    name:            str
    ragione_sociale: str
    vat_number:      str   # Partita IVA
    pec:             str   # PEC aziendale
    password:        str


@router.post("/register")
def register(req: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    email  = req.email.lower().strip()
    domain = _domain(email)

    vat    = req.vat_number.strip().upper().replace(" ", "")
    rs     = req.ragione_sociale.strip()

    pec = req.pec.lower().strip() if req.pec else ""

    if not vat:
        raise HTTPException(status_code=400, detail="Partita IVA obbligatoria")
    if not rs:
        raise HTTPException(status_code=400, detail="Ragione sociale obbligatoria")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="La password deve avere almeno 8 caratteri")

    # ── 1. Checksum P.IVA ────────────────────────────────────────────────────
    if not _validate_piva_checksum(vat):
        raise HTTPException(
            status_code=400,
            detail="Partita IVA non valida. Verifica le 11 cifre inserite (il codice di controllo non corrisponde).",
        )

    # ── 2. PEC ───────────────────────────────────────────────────────────────
    if not pec:
        raise HTTPException(status_code=400, detail="PEC aziendale obbligatoria")
    if not _is_valid_pec(pec):
        raise HTTPException(
            status_code=400,
            detail="PEC non valida. Inserisci un indirizzo PEC certificato (es. nome@arubapec.it, nome@legalmail.it).",
        )

    # ── 3. VIES — verifica P.IVA + confronto ragione sociale ─────────────────
    vies = _verify_vies(vat)
    if vies["valid"] is False:
        raise HTTPException(
            status_code=400,
            detail=(
                "Partita IVA non trovata nei registri europei. "
                "Verifica il numero inserito o contatta l'amministratore se pensi sia un errore."
            ),
        )
    if vies["valid"] is True and vies["name"] and vies["name"] != "---":
        if not _names_match(rs, vies["name"]):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"La ragione sociale non corrisponde ai dati ufficiali. "
                    f"Inserita: «{rs}» — Registrata: «{vies['name']}». "
                    f"Verifica la ragione sociale o contatta l'amministratore."
                ),
            )

    # Controllo P.IVA — se esiste ma è soft-deleted, riattiva senza bonus
    deleted_company = db.query(models.Company).filter(
        models.Company.vat_number == vat,
        models.Company.deleted_at.isnot(None),
    ).first()

    if deleted_company:
        # Controlla che la email non sia già usata da un altro account della stessa azienda
        email_conflict = db.query(models.Company).filter(
            models.Company.email == email,
            models.Company.vat_number == vat,
            models.Company.id != deleted_company.id,
            models.Company.deleted_at.is_(None),
        ).first()
        if email_conflict:
            raise HTTPException(status_code=400, detail="Impossibile creare l'account: questa email è già presente nella tua azienda.")

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
        _set_auth_cookie(response, token)
        return {
            "token_type":   "bearer",
            "name":         deleted_company.name,
            "email":        deleted_company.email,
            "credits":      deleted_company.credits,
            "is_admin":     False,
        }

    # Controllo: stessa email + stessa P.IVA non ammessa (email duplicata nella stessa azienda)
    if db.query(models.Company).filter(
        models.Company.email == email,
        models.Company.vat_number == vat,
        models.Company.deleted_at.is_(None),
    ).first():
        raise HTTPException(status_code=400, detail="Impossibile creare l'account: questa email è già presente nella tua azienda.")

    # Eredita i crediti dagli account esistenti con stessa P.IVA (pool condiviso)
    existing_vat = db.query(models.Company).filter(
        models.Company.vat_number == vat,
        models.Company.deleted_at.is_(None),
    ).first()
    inherited_credits = existing_vat.credits if existing_vat else 0

    company = models.Company(
        email           = email,
        name            = req.name.strip(),
        ragione_sociale = rs,
        vat_number      = vat,
        pec             = pec,
        password_hash   = auth_utils.hash_password(req.password),
        credits         = inherited_credits,
        is_active       = True,
        is_manager      = True,   # primo account = manager dell'azienda
    )
    db.add(company)
    db.commit()
    db.refresh(company)

    # Notifica admin nuova registrazione
    try:
        _notify_admin_new_company(company, tipo="Nuova azienda")
    except Exception:
        pass

    token = auth_utils.create_token({"sub": str(company.id)})
    _set_auth_cookie(response, token)
    return {
        "token_type":   "bearer",
        "name":         company.name,
        "email":        company.email,
        "credits":      company.credits,
        "is_admin":     False,
    }


# ── Slave account management (solo manager) ──────────────────────────────────

class CreateSlaveRequest(BaseModel):
    email:    str
    password: str
    name:     str = ""


@router.get("/slaves")
def list_slaves(
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Restituisce gli account slave sotto la stessa P.IVA (solo per manager)."""
    if not current.is_manager:
        raise HTTPException(status_code=403, detail="Solo il manager può gestire gli account del team.")
    slaves = (
        db.query(models.Company)
        .filter(
            models.Company.vat_number == current.vat_number,
            models.Company.is_manager == False,
            models.Company.deleted_at.is_(None),
        )
        .order_by(models.Company.created_at)
        .all()
    )
    return [
        {
            "id":         s.id,
            "name":       s.name,
            "email":      s.email,
            "is_active":  s.is_active,
            "created_at": s.created_at.isoformat(),
        }
        for s in slaves
    ]


@router.post("/create-slave", status_code=201)
def create_slave(
    req: CreateSlaveRequest,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Crea un account slave sotto la stessa azienda (solo manager)."""
    if not current.is_manager:
        raise HTTPException(status_code=403, detail="Solo il manager può creare account per il team.")

    email = req.email.lower().strip()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Email non valida")
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="Password di almeno 8 caratteri")

    if db.query(models.Company).filter(
        models.Company.email == email,
        models.Company.deleted_at.is_(None),
    ).first():
        raise HTTPException(status_code=400, detail="Email già in uso")

    slave = models.Company(
        email                = email,
        name                 = req.name.strip() or email.split('@')[0],
        ragione_sociale      = current.ragione_sociale,
        vat_number           = current.vat_number,
        pec                  = current.pec,
        password_hash        = auth_utils.hash_password(req.password),
        credits              = current.credits,
        is_active            = True,
        is_manager           = False,
        must_change_password = True,
    )
    db.add(slave)
    db.commit()
    db.refresh(slave)
    return {"message": f"Account '{slave.name}' creato con successo.", "id": slave.id}


@router.delete("/slaves/{slave_id}")
def delete_slave(
    slave_id: int,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Hard-delete di un account slave (solo manager). Rimozione completa dal DB."""
    if not current.is_manager:
        raise HTTPException(status_code=403, detail="Solo il manager può rimuovere account del team.")

    slave = db.query(models.Company).filter(
        models.Company.id == slave_id,
        models.Company.vat_number == current.vat_number,
        models.Company.is_manager == False,
    ).first()
    if not slave:
        raise HTTPException(status_code=404, detail="Account non trovato")

    db.delete(slave)
    db.commit()
    return {"message": "Account rimosso"}

@router.get("/verify-pec/{token}", response_class=HTMLResponse)
def verify_pec(token: str, db: Session = Depends(get_db)):
    record = db.query(models.PecVerificationToken).filter(
        models.PecVerificationToken.token == token,
        models.PecVerificationToken.used == False,
    ).first()

    if not record:
        return HTMLResponse(content=_html_result(
            "Link non valido",
            "Questo link non è valido o è già stato utilizzato.",
            success=False,
        ), status_code=400)

    if datetime.now(timezone.utc) > record.expires_at.replace(tzinfo=timezone.utc):
        return HTMLResponse(content=_html_result(
            "Link scaduto",
            "Il link è scaduto (validità 48 ore). Registrati nuovamente.",
            success=False,
        ), status_code=400)

    company = db.query(models.Company).filter(models.Company.id == record.company_id).first()
    if not company:
        return HTMLResponse(content=_html_result("Errore", "Account non trovato.", success=False), status_code=400)

    company.is_active = True
    record.used = True
    db.commit()

    return HTMLResponse(content=_html_result(
        "Account attivato!",
        f"La PEC è stata verificata con successo.<br>Puoi ora accedere con la tua email <strong>{company.email}</strong>.",
        success=True,
    ))


def _set_auth_cookie(response: Response, token: str) -> None:
    """Imposta il cookie HttpOnly con il token JWT."""
    is_prod = os.getenv("ENV", "development") == "production"
    response.set_cookie(
        key="token",
        value=token,
        httponly=True,               # JS non può leggerlo → immune a XSS
        secure=is_prod,              # True in prod (HTTPS), False in locale (HTTP)
        samesite="lax",              # protezione CSRF per navigazione normale
        max_age=60 * 60 * 24 * 7,   # 7 giorni
        path="/",
    )


@router.post("/login")
def login(req: LoginRequest, request: Request, response: Response, db: Session = Depends(get_db)):
    company = db.query(models.Company).filter(
        models.Company.email == req.email.lower().strip()
    ).first()

    if not company or not auth_utils.verify_password(req.password, company.password_hash):
        raise HTTPException(status_code=401, detail="Email o password errati")

    if not company.is_active:
        raise HTTPException(status_code=403, detail="Account disattivato. Contatta l'amministratore.")

    # Salva IP (considera X-Forwarded-For per proxy/Render)
    forwarded = request.headers.get("x-forwarded-for")
    company.last_ip       = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    company.last_login_at = datetime.now(timezone.utc)
    db.commit()

    token = auth_utils.create_token({"sub": str(company.id)})
    _set_auth_cookie(response, token)
    return {
        "token_type": "bearer",
        "name": company.name,
        "email": company.email,
        "credits": company.credits,
        "is_admin": company.email == auth_utils.ADMIN_EMAIL,
        "must_change_password": bool(company.must_change_password),
    }


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("token", path="/")
    return {"message": "Logout effettuato"}


@router.get("/me")
def me(current: models.Company = Depends(auth_utils.get_current_company), db: Session = Depends(get_db)):
    # Per gli slave, le info sull'abbonamento vengono dal manager della stessa P.IVA
    manager = current
    if not current.is_manager and current.vat_number:
        mgr = (
            db.query(models.Company)
            .filter(
                models.Company.vat_number == current.vat_number,
                models.Company.is_manager == True,
                models.Company.deleted_at.is_(None),
            )
            .first()
        )
        if mgr:
            manager = mgr
    return {
        "id":                    current.id,
        "email":                 current.email,
        "name":                  current.name,
        "ragione_sociale":       current.ragione_sociale or "",
        "vat_number":            current.vat_number or "",
        "credits":               current.credits,
        "is_admin":              current.email == auth_utils.ADMIN_EMAIL,
        "is_manager":            bool(current.is_manager),
        "subscription_active":   bool(current.subscription_active),
        "subscription_plan":     manager.subscription_plan,
        "subscription_end_date": manager.subscription_end_date.strftime("%d/%m/%Y") if manager.subscription_end_date else None,
        "subscription_cancelled":current.subscription_cancelled if hasattr(current, 'subscription_cancelled') else False,
        "welcome_bonus_requested":current.welcome_bonus_requested if hasattr(current, 'welcome_bonus_requested') else False,
        "created_at":            current.created_at.isoformat(),
    }


@router.post("/support", status_code=201)
def send_support_ticket(
    body: dict,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Invia una richiesta di assistenza all'admin."""
    subject = (body.get("subject") or "").strip()
    message = (body.get("message") or "").strip()
    if not subject or not message:
        raise HTTPException(status_code=400, detail="Oggetto e messaggio obbligatori")
    if len(message) > 5000:
        raise HTTPException(status_code=400, detail="Messaggio troppo lungo (max 5000 caratteri)")

    ticket = models.SupportTicket(
        company_id = current.id,
        subject    = subject,
        message    = message,
    )
    db.add(ticket)
    db.flush()  # ottieni ticket.id prima del commit

    # Crea il primo messaggio nella conversazione
    first_msg = models.TicketMessage(
        ticket_id = ticket.id,
        sender    = "client",
        text      = message,
    )
    db.add(first_msg)
    db.commit()

    try:
        import email_utils
        email_utils.notify_support_ticket(
            company_name  = current.ragione_sociale or current.name,
            company_email = current.email,
            subject       = subject,
            message       = message,
        )
    except Exception:
        pass

    return {"message": "Richiesta inviata. Ti risponderemo via email il prima possibile."}


@router.get("/tickets")
def list_tickets(
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Elenco dei ticket del cliente."""
    tickets = (
        db.query(models.SupportTicket)
        .filter(models.SupportTicket.company_id == current.id)
        .order_by(models.SupportTicket.created_at.desc())
        .all()
    )
    return [
        {
            "id":         t.id,
            "subject":    t.subject,
            "status":     t.status,
            "created_at": t.created_at.isoformat(),
            "last_msg":   t.messages[-1].text[:80] if t.messages else t.message[:80],
        }
        for t in tickets
    ]


@router.get("/tickets/{ticket_id}")
def get_ticket(
    ticket_id: int,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Dettaglio ticket con storia messaggi."""
    ticket = db.query(models.SupportTicket).filter(
        models.SupportTicket.id == ticket_id,
        models.SupportTicket.company_id == current.id,
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    return {
        "id":         ticket.id,
        "subject":    ticket.subject,
        "status":     ticket.status,
        "created_at": ticket.created_at.isoformat(),
        "messages":   [
            {"id": m.id, "sender": m.sender, "text": m.text, "created_at": m.created_at.isoformat()}
            for m in ticket.messages
        ],
    }


@router.post("/tickets/{ticket_id}/message", status_code=201)
def reply_ticket(
    ticket_id: int,
    body: dict,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Il cliente invia un follow-up su un ticket esistente."""
    ticket = db.query(models.SupportTicket).filter(
        models.SupportTicket.id == ticket_id,
        models.SupportTicket.company_id == current.id,
        models.SupportTicket.status != "risolto",
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato o già chiuso")
    text = (body.get("text") or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="Messaggio vuoto")

    msg = models.TicketMessage(ticket_id=ticket.id, sender="client", text=text)
    ticket.status = "in_elaborazione"
    db.add(msg)
    db.commit()
    return {"message": "Messaggio inviato"}


@router.post("/tickets/{ticket_id}/close", status_code=200)
def close_ticket(
    ticket_id: int,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Il cliente chiude il ticket."""
    ticket = db.query(models.SupportTicket).filter(
        models.SupportTicket.id == ticket_id,
        models.SupportTicket.company_id == current.id,
    ).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    ticket.status = "risolto"
    db.commit()
    return {"message": "Ticket chiuso"}


@router.delete("/me")
def delete_account(
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Soft-delete dell'account aziendale (solo manager). Tutti i dati vengono conservati."""
    if not current.is_manager:
        raise HTTPException(status_code=403, detail="Solo il manager può eliminare l'account aziendale.")
    # Soft-delete di tutti gli account slave della stessa P.IVA
    db.query(models.Company).filter(
        models.Company.vat_number == current.vat_number,
        models.Company.is_manager == False,
        models.Company.deleted_at.is_(None),
    ).update({"deleted_at": datetime.now(timezone.utc), "is_active": False})
    # Soft-delete del manager
    current.deleted_at = datetime.now(timezone.utc)
    current.is_active  = False
    db.commit()
    return {"message": "Account eliminato"}


@router.delete("/team/hard")
def hard_delete_team(
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Hard-delete di tutti gli account slave (solo manager). Rimozione completa dal DB."""
    if not current.is_manager:
        raise HTTPException(status_code=403, detail="Solo il manager può eliminare il team.")
    slaves = db.query(models.Company).filter(
        models.Company.vat_number == current.vat_number,
        models.Company.is_manager == False,
    ).all()
    for slave in slaves:
        db.delete(slave)
    db.commit()
    return {"message": f"{len(slaves)} account eliminati dal database"}


@router.post("/change-email")
def change_email(
    body: dict,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    new_email = body.get("new_email", "").lower().strip()
    password  = body.get("password", "")

    if not new_email or "@" not in new_email:
        raise HTTPException(status_code=400, detail="Email non valida")
    if not auth_utils.verify_password(password, current.password_hash):
        raise HTTPException(status_code=400, detail="Password errata")
    if db.query(models.Company).filter(
        models.Company.email == new_email,
        models.Company.id != current.id,
        models.Company.deleted_at.is_(None),
    ).first():
        raise HTTPException(status_code=400, detail="Email già in uso")

    # Invalida eventuali token precedenti per questo utente
    db.query(models.EmailChangeToken).filter(
        models.EmailChangeToken.company_id == current.id,
        models.EmailChangeToken.used == False,
    ).update({"used": True})

    token = secrets.token_urlsafe(32)
    expires = datetime.now(timezone.utc) + timedelta(hours=24)

    db.add(models.EmailChangeToken(
        company_id = current.id,
        new_email  = new_email,
        token      = token,
        expires_at = expires,
    ))
    db.commit()

    base_url = os.getenv("BASE_URL", "https://solardino.it")
    confirm_url = f"{base_url}/auth/confirm-email/{token}"

    html = f"""<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.13);">

        <!-- Header -->
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:36px 40px;text-align:center;">
            <div style="display:inline-block;background:#f59e0b;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;margin-bottom:16px;">☀️</div>
            <h1 style="margin:0;color:#f1f5f9;font-size:22px;font-weight:700;letter-spacing:-0.3px;">SolarDino</h1>
            <p style="margin:6px 0 0;color:#94a3b8;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;">Conferma cambio email</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:40px 40px 32px;">
            <p style="margin:0 0 8px;color:#64748b;font-size:14px;">Ciao,</p>
            <p style="margin:0 0 24px;color:#1e293b;font-size:16px;line-height:1.6;">
              Hai richiesto di aggiornare l'indirizzo email del tuo account SolarDino al seguente:
            </p>

            <!-- New email pill -->
            <div style="background:#f8fafc;border:2px solid #f59e0b;border-radius:12px;padding:16px 20px;text-align:center;margin-bottom:28px;">
              <p style="margin:0;color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:0.8px;font-weight:600;">Nuova email</p>
              <p style="margin:6px 0 0;color:#0f172a;font-size:18px;font-weight:700;">{new_email}</p>
            </div>

            <p style="margin:0 0 28px;color:#475569;font-size:14px;line-height:1.6;">
              Clicca il bottone qui sotto per confermare la modifica. Il link è valido per <strong>24 ore</strong>.
            </p>

            <!-- CTA Button -->
            <div style="text-align:center;margin-bottom:32px;">
              <a href="{confirm_url}"
                 style="display:inline-block;background:linear-gradient(135deg,#f59e0b,#d97706);color:#0f172a;font-weight:700;font-size:16px;padding:16px 40px;border-radius:12px;text-decoration:none;letter-spacing:0.2px;box-shadow:0 4px 14px rgba(245,158,11,0.4);">
                ✅ &nbsp;Conferma nuova email
              </a>
            </div>

            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;">

            <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
              Se non hai richiesto questo cambio, puoi ignorare questa email in modo sicuro.<br>
              La tua email attuale rimarrà invariata.
            </p>
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">
              SolarDino — AI Solar Panel Analysis &nbsp;·&nbsp; © 2026<br>
              <span style="color:#cbd5e1;">Questa email è stata inviata automaticamente, non rispondere.</span>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""
    send_email(new_email, "SolarDino — Conferma il cambio email", html)

    return {"message": "Email di verifica inviata. Controlla la casella della nuova email per confermare."}


@router.get("/confirm-email/{token}", response_class=HTMLResponse)
def confirm_email_change(token: str, db: Session = Depends(get_db)):
    record = db.query(models.EmailChangeToken).filter(
        models.EmailChangeToken.token == token,
        models.EmailChangeToken.used == False,
    ).first()

    if not record:
        return HTMLResponse(content=_html_result(
            "Link non valido",
            "Questo link non è valido o è già stato utilizzato.",
            success=False,
        ), status_code=400)

    if datetime.now(timezone.utc) > record.expires_at.replace(tzinfo=timezone.utc):
        return HTMLResponse(content=_html_result(
            "Link scaduto",
            "Il link è scaduto. Richiedi un nuovo cambio email dalla dashboard.",
            success=False,
        ), status_code=400)

    company = db.query(models.Company).filter(models.Company.id == record.company_id).first()
    if not company:
        return HTMLResponse(content=_html_result(
            "Errore",
            "Account non trovato.",
            success=False,
        ), status_code=400)

    company.email   = record.new_email
    record.used     = True
    db.commit()

    return HTMLResponse(content=_html_result(
        "Email aggiornata!",
        f"La tua email è stata aggiornata a <strong>{record.new_email}</strong>.<br>Accedi ora con la nuova email.",
        success=True,
    ))


def _html_result(title: str, message: str, success: bool) -> str:
    color = "#34d399" if success else "#f87171"
    icon  = "✅" if success else "❌"
    return f"""<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><title>{title} — SolarDino</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{{margin:0;font-family:sans-serif;background:#0f172a;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;}}
.card{{background:#1e293b;border-radius:16px;padding:40px;max-width:480px;text-align:center;border:1px solid #334155;}}
h1{{color:{color};margin-top:0;}}a{{color:#f59e0b;}}
</style></head>
<body><div class="card">
<div style="font-size:48px;">{icon}</div>
<h1>{title}</h1>
<p style="color:#94a3b8;">{message}</p>
<a href="/" style="display:inline-block;margin-top:24px;padding:12px 24px;background:#f59e0b;color:#0f172a;font-weight:700;border-radius:10px;text-decoration:none;">
  Vai alla dashboard
</a>
</div></body></html>"""


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

    html = f"""<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:560px;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.13);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a 0%,#1e293b 100%);padding:36px 40px;text-align:center;">
            <div style="display:inline-block;background:#f59e0b;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;margin-bottom:16px;">☀️</div>
            <h1 style="margin:0;color:#f1f5f9;font-size:22px;font-weight:700;letter-spacing:-0.3px;">SolarDino</h1>
            <p style="margin:6px 0 0;color:#94a3b8;font-size:13px;letter-spacing:0.5px;text-transform:uppercase;">Avviso di sicurezza</p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:40px 40px 32px;">
            <p style="margin:0 0 8px;color:#64748b;font-size:14px;">Ciao {current.name},</p>
            <p style="margin:0 0 24px;color:#1e293b;font-size:16px;line-height:1.6;">
              La password del tuo account SolarDino è stata modificata con successo.
            </p>
            <div style="background:#f0fdf4;border:2px solid #34d399;border-radius:12px;padding:16px 20px;text-align:center;margin-bottom:28px;">
              <p style="margin:0;color:#065f46;font-size:15px;font-weight:600;">✅ Password aggiornata</p>
              <p style="margin:6px 0 0;color:#6b7280;font-size:13px;">Modifica effettuata in data {datetime.now(timezone.utc).strftime('%d/%m/%Y alle %H:%M')} UTC</p>
            </div>
            <p style="margin:0 0 28px;color:#475569;font-size:14px;line-height:1.6;">
              Se non sei stato tu a effettuare questa modifica, contatta immediatamente il supporto.
            </p>
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0 0 24px;">
            <p style="margin:0;color:#94a3b8;font-size:12px;line-height:1.6;">
              Questa è un'email automatica di sicurezza. Non rispondere a questo messaggio.
            </p>
          </td>
        </tr>
        <tr>
          <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e2e8f0;">
            <p style="margin:0;color:#94a3b8;font-size:12px;">
              SolarDino — AI Solar Panel Analysis &nbsp;·&nbsp; © 2026
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>"""
    send_email(current.email, "SolarDino — Password modificata", html)

    current.must_change_password = False
    db.commit()

    return {"message": "Password aggiornata con successo"}


# ---------------------------------------------------------------------------
# Notifiche cliente
# ---------------------------------------------------------------------------

@router.get("/notifications")
def get_notifications(
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    notifs = (
        db.query(models.Notification)
        .filter(models.Notification.company_id == current.id)
        .order_by(models.Notification.created_at.desc())
        .limit(50)
        .all()
    )
    return [
        {
            "id": n.id,
            "title": n.title,
            "message": n.message,
            "ticket_id": n.ticket_id,
            "is_read": n.is_read,
            "created_at": n.created_at.isoformat(),
        }
        for n in notifs
    ]


@router.post("/notifications/{notif_id}/read")
def mark_notification_read(
    notif_id: int,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    n = db.query(models.Notification).filter(
        models.Notification.id == notif_id,
        models.Notification.company_id == current.id,
    ).first()
    if n:
        n.is_read = True
        db.commit()
    return {"ok": True}


@router.get("/check-vat/{vat}")
def check_vat(vat: str, db: Session = Depends(get_db)):
    """Verifica se esiste già un'azienda con questa P.IVA."""
    print(f"[CHECK-VAT] Richiesta per P.IVA: '{vat}'")
    vat = vat.strip().upper().replace(" ", "")
    if not vat:
        print("[CHECK-VAT] P.IVA vuota")
        raise HTTPException(status_code=400, detail="Partita IVA obbligatoria")

    print(f"[CHECK-VAT] Cerco azienda con vat_number='{vat}' nel DB...")
    try:
        company = db.query(models.Company).filter(
            models.Company.vat_number == vat,
            models.Company.deleted_at.is_(None),
        ).first()
    except Exception as e:
        print(f"[CHECK-VAT] ERRORE DB: {e}")
        raise HTTPException(status_code=500, detail="Errore database")

    if not company:
        print(f"[CHECK-VAT] Nessuna azienda trovata per P.IVA '{vat}'")
        raise HTTPException(
            status_code=404,
            detail="Nessuna azienda trovata con questa Partita IVA. Usa la registrazione completa.",
        )

    print(f"[CHECK-VAT] Trovata: '{company.ragione_sociale}' (id={company.id})")
    return {
        "found": True,
        "ragione_sociale": company.ragione_sociale or "",
    }


@router.post("/register-fast")
def register_fast(body: dict, response: Response, db: Session = Depends(get_db)):
    """Registrazione semplificata per chi appartiene a un'azienda già registrata."""
    vat      = (body.get("vat_number") or "").strip().upper().replace(" ", "")
    name     = (body.get("name") or "").strip()
    email    = (body.get("email") or "").lower().strip()
    password = body.get("password") or ""

    if not vat or not name or not email or not password:
        raise HTTPException(status_code=400, detail="Tutti i campi sono obbligatori")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="La password deve avere almeno 8 caratteri")
    if "@" not in email:
        raise HTTPException(status_code=400, detail="Email non valida")

    existing = db.query(models.Company).filter(
        models.Company.vat_number == vat,
        models.Company.deleted_at.is_(None),
    ).first()

    if not existing:
        raise HTTPException(
            status_code=404,
            detail="Azienda non trovata. Usa la registrazione completa.",
        )

    # Email già presente nella stessa azienda?
    if db.query(models.Company).filter(
        models.Company.email == email,
        models.Company.vat_number == vat,
        models.Company.deleted_at.is_(None),
    ).first():
        raise HTTPException(
            status_code=400,
            detail="Impossibile creare l'account: questa email è già presente nella tua azienda.",
        )

    company = models.Company(
        email           = email,
        name            = name,
        ragione_sociale = existing.ragione_sociale,
        vat_number      = vat,
        pec             = existing.pec,
        password_hash   = auth_utils.hash_password(password),
        credits         = existing.credits,
        is_active       = True,
    )
    db.add(company)
    db.commit()
    db.refresh(company)

    # Notifica admin nuovo dipendente registrato
    try:
        _notify_admin_new_company(company, tipo="Nuovo dipendente registrato")
    except Exception:
        pass

    token = auth_utils.create_token({"sub": str(company.id)})
    _set_auth_cookie(response, token)
    return {
        "token_type":   "bearer",
        "name":         company.name,
        "email":        company.email,
        "credits":      company.credits,
        "is_admin":     False,
    }


@router.post("/request-welcome-bonus", status_code=201)
def request_welcome_bonus(
    request: Request,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Il cliente richiede il bonus di benvenuto (una sola volta)."""
    if current.welcome_bonus_requested:
        raise HTTPException(status_code=400, detail="Bonus già richiesto")
    if current.welcome_bonus_used:
        raise HTTPException(status_code=400, detail="Bonus già utilizzato")
    if current.subscription_active:
        raise HTTPException(status_code=400, detail="Hai già un abbonamento attivo")

    ip = request.client.host if request.client else None
    req = models.WelcomeBonusRequest(
        company_id=current.id,
        ip=ip,
    )
    current.welcome_bonus_requested = True
    db.add(req)
    db.commit()
    return {"message": "Richiesta inviata. Sarai contattato a breve."}
