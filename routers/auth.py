import html
import os
import re
import secrets
from typing import Optional
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

import auth_utils
import models
from database import get_db
from email_utils import send_email

router = APIRouter(prefix="/auth", tags=["Auth"])

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://solar-dinoweb.fly.dev")


def _extract_ipv4(request: Request) -> Optional[str]:
    """Return the client IPv4 address, ignoring IPv6 addresses (they contain ':')."""
    forwarded = request.headers.get("x-forwarded-for")
    raw = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    if raw and ":" in raw:
        # IPv6 address — not used for duplicate detection
        return None
    return raw or None


ADMIN_EMAIL_NOTIFY = os.getenv("ADMIN_EMAIL", "agervasini1@gmail.com")

def _notify_admin_new_company(company: "models.Company", tipo: str) -> None:
    """Invia email all'admin quando si registra una nuova azienda o dipendente."""
    # Escape user content to prevent XSS in the admin email
    rs    = html.escape(company.ragione_sociale or "—")
    name  = html.escape(company.name or "—")
    email = html.escape(company.email or "—")
    tipo_safe = html.escape(tipo)
    body = f"""<!DOCTYPE html>
<html lang="it">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:40px 16px;">
    <tr><td align="center">
      <table width="100%" style="max-width:520px;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.13);">
        <tr>
          <td style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#f59e0b;font-size:20px;font-weight:700;">&#9728;&#65039; SolarDino</h1>
            <p style="margin:8px 0 0;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px;">{tipo_safe}</p>
          </td>
        </tr>
        <tr>
          <td style="background:#fff;padding:36px 40px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Ragione sociale</span><br>
                <strong style="color:#0f172a;font-size:15px;">{rs}</strong>
              </td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Referente</span><br>
                <strong style="color:#0f172a;">{name}</strong>
              </td></tr>
              <tr><td style="padding:10px 0;">
                <span style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;">Email</span><br>
                <strong style="color:#0f172a;">{email}</strong>
              </td></tr>
            </table>
            <div style="margin-top:28px;text-align:center;">
              <a href="{FRONTEND_URL}/admin"
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
    send_email(ADMIN_EMAIL_NOTIFY, f"SolarDino — {tipo}: {company.ragione_sociale or company.name}", body)


class LoginRequest(BaseModel):
    email: str
    password: str


class RegisterRequest(BaseModel):
    email:           str
    ragione_sociale: str
    password:        str


@router.post("/register")
def register(req: RegisterRequest, response: Response, request: Request, db: Session = Depends(get_db)):
    email = req.email.lower().strip()
    rs    = req.ragione_sociale.strip()

    # ── Validazione campi ────────────────────────────────────────────────────
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Email non valida")
    if not rs:
        raise HTTPException(status_code=400, detail="Ragione sociale obbligatoria")
    if len(rs) < 3:
        raise HTTPException(status_code=400, detail="La ragione sociale deve avere almeno 3 caratteri")
    if len(rs) > 150:
        raise HTTPException(status_code=400, detail="La ragione sociale non può superare i 150 caratteri")
    if not re.match(r"^[\w\s\.\,\-\&\'\"\/\(\)\+]+$", rs, re.UNICODE):
        raise HTTPException(status_code=400, detail="La ragione sociale contiene caratteri non validi")
    # Deve contenere almeno una forma giuridica riconoscibile
    _LEGAL_FORMS = r"\b(srl|s\.r\.l|s\.r\.l\.|spa|s\.p\.a|snc|s\.n\.c|sas|s\.a\.s|srls|s\.r\.l\.s|ss|s\.s|coop|scarl|onlus|ets|di|e\.i)\b"
    if not re.search(_LEGAL_FORMS, rs, re.IGNORECASE):
        raise HTTPException(
            status_code=400,
            detail="La ragione sociale deve includere la forma giuridica (es. Srl, Spa, Snc, Sas...).",
        )
    if len(req.password) < 8:
        raise HTTPException(status_code=400, detail="La password deve avere almeno 8 caratteri")

    # ── Email già in uso ─────────────────────────────────────────────────────
    if db.query(models.Company).filter(
        models.Company.email == email,
        models.Company.deleted_at.is_(None),
    ).first():
        raise HTTPException(status_code=400, detail="Email già in uso")

    # ── Pool crediti: stessa ragione sociale → eredita crediti ───────────────
    rs_lower = rs.lower()
    existing_rs = db.query(models.Company).filter(
        func.lower(func.trim(models.Company.ragione_sociale)) == rs_lower,
        models.Company.deleted_at.is_(None),
    ).first()
    inherited_credits = existing_rs.credits if existing_rs else 0

    # ── Controllo IP duplicato ───────────────────────────────────────────────
    reg_ip = _extract_ipv4(request)

    ip_already_used = False
    if reg_ip:
        # Considera duplicato solo se l'IP è già usato da un'azienda con ragione sociale DIVERSA
        other_with_ip = db.query(models.Company).filter(
            models.Company.last_ip == reg_ip,
            models.Company.deleted_at.is_(None),
            models.Company.is_active == True,
            func.lower(func.trim(models.Company.ragione_sociale)) != rs_lower,
        ).first()
        if other_with_ip:
            ip_already_used = True

    # ── Rate limit: max 3 nuove aziende dallo stesso IP nelle ultime 24 ore ──
    if reg_ip:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        recent_from_ip = (
            db.query(func.count(models.Company.id))
            .filter(
                models.Company.last_ip == reg_ip,
                models.Company.created_at >= cutoff,
                models.Company.deleted_at.is_(None),
            )
            .scalar()
        ) or 0
        if recent_from_ip >= 3:
            raise HTTPException(
                status_code=429,
                detail="Troppe registrazioni dallo stesso IP. Riprova tra 24 ore.",
            )

    # ── Bonus 1 credito se IP nuovo (nessun'altra azienda diversa) e ragione sociale nuova ──
    bonus_credit = 0
    bonus_used   = False
    bonus_avail  = 0
    if not existing_rs and not ip_already_used:
        bonus_credit = 1
        bonus_used   = True
        bonus_avail  = 1   # credito disponibile — va a 0 quando usato

    # Se IP duplicato con ragione sociale diversa → 0 crediti anche se ragione sociale nuova
    final_credits = 0 if (ip_already_used and not existing_rs) else (inherited_credits + bonus_credit)

    company = models.Company(
        email              = email,
        name               = rs,   # nome = ragione sociale (campo legacy)
        ragione_sociale    = rs,
        password_hash      = auth_utils.hash_password(req.password),
        credits            = final_credits,
        is_active          = True,
        last_ip            = reg_ip,
        welcome_bonus_used = bonus_used,
        bonus_credits      = bonus_avail,
    )
    db.add(company)
    db.commit()
    db.refresh(company)

    try:
        _notify_admin_new_company(company, tipo="Nuova azienda")
    except Exception:
        pass

    token = auth_utils.create_token({"sub": str(company.id)})
    _set_auth_cookie(response, token)
    return {
        "token_type":      "bearer",
        "name":            company.name,
        "email":           company.email,
        "credits":         company.credits,
        "is_admin":        False,
        "ip_already_used": ip_already_used,
    }



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

    # Salva IP — solo IPv4 (IPv6 ignorato per controllo duplicati)
    login_ip = _extract_ipv4(request)
    company.last_ip       = login_ip
    company.last_login_at = datetime.now(timezone.utc)
    db.commit()

    # Controlla se l'IP è già usato da un'altra azienda con ragione sociale diversa
    ip_already_used = False
    if login_ip and company.ragione_sociale:
        rs_lower = company.ragione_sociale.strip().lower()
        other_with_ip = db.query(models.Company).filter(
            models.Company.last_ip == login_ip,
            models.Company.id != company.id,
            models.Company.deleted_at.is_(None),
            models.Company.is_active == True,
            func.lower(func.trim(models.Company.ragione_sociale)) != rs_lower,
        ).first()
        if other_with_ip:
            ip_already_used = True

    token = auth_utils.create_token({"sub": str(company.id)})
    _set_auth_cookie(response, token)
    return {
        "token_type":      "bearer",
        "name":            company.name,
        "email":           company.email,
        "credits":         company.credits,
        "is_admin":        bool(company.is_admin),
        "ip_already_used": ip_already_used,
    }


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie("token", path="/")
    return {"message": "Logout effettuato"}


@router.get("/me")
def me(current: models.Company = Depends(auth_utils.get_current_company), db: Session = Depends(get_db)):
    # Controlla se l'IP è già usato da un'altra azienda attiva
    ip_already_used = False
    if current.last_ip:
        other_with_ip = db.query(models.Company).filter(
            models.Company.last_ip == current.last_ip,
            models.Company.id != current.id,
            models.Company.deleted_at.is_(None),
            models.Company.is_active == True,
        ).first()
        if other_with_ip:
            ip_already_used = True

    return {
        "id":                     current.id,
        "email":                  current.email,
        "name":                   current.name,
        "ragione_sociale":        current.ragione_sociale or "",
        "credits":                current.credits,
        "is_admin":               bool(current.is_admin),
        "subscription_active":    bool(current.subscription_active),
        "subscription_plan":      current.subscription_plan,
        "subscription_end_date":  current.subscription_end_date.strftime("%d/%m/%Y") if current.subscription_end_date else None,
        "subscription_cancelled": bool(current.subscription_cancelled) if hasattr(current, 'subscription_cancelled') else False,
        "welcome_bonus_requested":bool(current.welcome_bonus_requested) if hasattr(current, 'welcome_bonus_requested') else False,
        "ip_already_used":        ip_already_used,
        "created_at":             current.created_at.isoformat(),
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
    """Soft-delete dell'account. Tutti i dati vengono conservati."""
    if current.is_admin:
        raise HTTPException(status_code=403, detail="L'account amministratore non può essere eliminato.")
    current.deleted_at = datetime.now(timezone.utc)
    current.is_active  = False
    db.commit()
    return {"message": "Account eliminato"}


@router.delete("/me/company")
def delete_company_account(
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    """Soft-delete di tutti gli account con la stessa ragione_sociale."""
    if current.is_admin:
        raise HTTPException(status_code=403, detail="L'account amministratore non può essere eliminato.")
    if not current.ragione_sociale:
        raise HTTPException(status_code=400, detail="Nessuna ragione sociale associata.")

    now = datetime.now(timezone.utc)
    accounts = db.query(models.Company).filter(
        models.Company.ragione_sociale == current.ragione_sociale,
        models.Company.deleted_at.is_(None),
        models.Company.is_admin == False,
    ).all()

    for acc in accounts:
        acc.deleted_at         = now
        acc.is_active          = False
        acc.subscription_active = False
        acc.credits            = 0

    db.commit()
    return {"message": f"Account aziendale eliminato ({len(accounts)} utenti)"}


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
    # ── Avviso scadenza elaborazioni extra (7 giorni prima del rinnovo) ──────
    if current.subscription_active and current.subscription_end_date is not None:
        from datetime import timezone as _tz, timedelta as _td
        now = datetime.now(_tz.utc)
        end = current.subscription_end_date
        if end.tzinfo is None:
            end = end.replace(tzinfo=_tz.utc)
        days_left = (end - now).days
        if 0 <= days_left <= 7:
            cutoff = end - _td(days=8)
            already_sent = db.query(models.Notification).filter(
                models.Notification.company_id == current.id,
                models.Notification.title == "Elaborazioni in scadenza",
                models.Notification.created_at >= cutoff,
            ).first()
            if not already_sent:
                db.add(models.Notification(
                    company_id=current.id,
                    title="Elaborazioni in scadenza",
                    message=(
                        f"Attenzione: tra {days_left} giorn{'o' if days_left == 1 else 'i'} "
                        f"({end.strftime('%d/%m/%Y')}) avverrà il rinnovo dell'abbonamento e "
                        "le elaborazioni extra acquistate andranno perse. "
                        "Utilizzale prima della scadenza."
                    ),
                ))
                db.commit()
    # ────────────────────────────────────────────────────────────────────────
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
