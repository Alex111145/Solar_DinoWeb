import os
from datetime import datetime, timezone, timedelta
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

import auth_utils
from auth_utils import sync_credits_by_vat
import models
import storage_utils
from database import get_db

router = APIRouter(prefix="/admin", tags=["Admin"])

PRICE_PER_PANEL = float(os.getenv("PRICE_PER_PANEL", "0.01"))  # € per pannello rilevato
UPLOAD_DIR      = os.getenv("UPLOAD_DIR", "elaborazioni")


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    total_companies = (
        db.query(func.count(models.Company.id))
        .filter(
            models.Company.email != auth_utils.ADMIN_EMAIL,
            models.Company.is_active == True,
            models.Company.deleted_at.is_(None),
        )
        .scalar()
    )
    total_jobs = db.query(func.count(models.Job.id)).scalar()
    completed  = (
        db.query(func.count(models.Job.id))
        .filter(models.Job.status == "completato")
        .scalar()
    )
    total_panels = (
        db.query(func.sum(models.Job.panels_detected))
        .filter(models.Job.status == "completato")
        .scalar()
    ) or 0

    now             = datetime.now(timezone.utc)
    last_30_days    = now - timedelta(days=30)

    # Fatturato totale = somma di tutti i pagamenti approvati (Stripe + bonifico)
    total_stripe = db.query(func.sum(models.StripePayment.amount_eur)).scalar() or 0
    total_bonif  = (
        db.query(func.sum(models.BonificoRequest.amount_eur))
        .filter(models.BonificoRequest.status == "approved")
        .scalar()
    ) or 0
    total_revenue = total_stripe + total_bonif

    # Fatturato mese corrente = solo abbonamenti attivati negli ultimi 30 gg
    SUBSCRIPTION_PACKAGES = ('starter', 'medium', 'unlimited', 'unlimited_annual')
    revenue_current_month = (
        db.query(func.sum(models.StripePayment.amount_eur))
        .filter(
            models.StripePayment.created_at >= last_30_days,
            models.StripePayment.package.in_(SUBSCRIPTION_PACKAGES),
        )
        .scalar()
    ) or 0

    return {
        "active_companies":        total_companies,
        "total_jobs":              total_jobs,
        "completed_jobs":          completed,
        "total_panels_detected":   total_panels,
        "total_revenue_eur":       round(total_revenue, 2),
        "revenue_month_eur":       round(revenue_current_month, 2),
        "price_per_panel":         PRICE_PER_PANEL,
    }


# ---------------------------------------------------------------------------
# Companies CRUD
# ---------------------------------------------------------------------------

@router.get("/companies")
def list_companies(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    companies = (
        db.query(models.Company)
        .filter(
            models.Company.email != auth_utils.ADMIN_EMAIL,
            models.Company.deleted_at.is_(None),
        )
        .order_by(models.Company.created_at.desc())
        .all()
    )

    # Trova IP duplicati SOLO tra aziende attive (disabilitate non contano)
    all_ips = [c.last_ip for c in companies if c.last_ip and c.last_ip != "—" and c.is_active]
    duplicate_ips = {ip for ip in all_ips if all_ips.count(ip) > 1}

    result = []
    for c in companies:
        jobs_done = (
            db.query(func.count(models.Job.id))
            .filter(models.Job.company_id == c.id, models.Job.status == "completato")
            .scalar()
        )
        panels = (
            db.query(func.sum(models.Job.panels_detected))
            .filter(models.Job.company_id == c.id, models.Job.status == "completato")
            .scalar()
        ) or 0
        amount_owed = panels * PRICE_PER_PANEL

        result.append({
            "id":               c.id,
            "name":             c.name,
            "ragione_sociale":  c.ragione_sociale or "",
            "vat_number":       c.vat_number or "",
            "email":            c.email,
            "credits":          c.credits,
            "is_active":        c.is_active,
            "jobs_completed":   jobs_done,
            "panels_detected":  panels,
            "amount_owed_eur":  round(amount_owed, 2),
            "last_ip":              c.last_ip or "—",
            "ip_status":            "warning" if c.is_active and c.last_ip and c.last_ip in duplicate_ips else "ok",
            "welcome_bonus_used":   bool(c.welcome_bonus_used),
            "last_login_at":        c.last_login_at.isoformat() if c.last_login_at else None,
            "created_at":           c.created_at.isoformat(),
            "subscription_active":  bool(c.subscription_active),
            "subscription_plan":    c.subscription_plan,
            "subscription_start_date": c.subscription_start_date.strftime("%d/%m/%Y") if c.subscription_start_date else None,
            "subscription_end_date":   c.subscription_end_date.strftime("%d/%m/%Y") if c.subscription_end_date else None,
        })

    return result


class CreateCompanyBody(BaseModel):
    email:    str
    name:     str
    password: str
    credits:  int = 3


@router.post("/companies", status_code=201)
def create_company(
    body: CreateCompanyBody,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    if db.query(models.Company).filter(models.Company.email == body.email.lower()).first():
        raise HTTPException(status_code=400, detail="Email già registrata")

    company = models.Company(
        email         = body.email.lower().strip(),
        name          = body.name.strip(),
        password_hash = auth_utils.hash_password(body.password),
        credits       = body.credits,
    )
    db.add(company)
    db.commit()
    db.refresh(company)
    return {"message": f"Azienda '{company.name}' creata", "id": company.id}


class UpdateCompanyBody(BaseModel):
    is_active: Optional[bool] = None
    credits:   Optional[int]  = None
    name:      Optional[str]  = None


@router.patch("/companies/{company_id}")
def update_company(
    company_id: int,
    body: UpdateCompanyBody,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")

    if body.is_active is not None:
        company.is_active = body.is_active
    if body.credits is not None:
        company.credits = body.credits
        sync_credits_by_vat(db, company.vat_number, body.credits)
    if body.name:
        company.name = body.name.strip()

    db.commit()
    return {"message": "Azienda aggiornata"}


@router.post("/companies/{company_id}/activate")
def activate_company(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")
    company.is_active = True
    db.commit()
    return {"message": "Azienda attivata"}


@router.post("/companies/{company_id}/deactivate")
def deactivate_company(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")
    company.is_active = False
    db.commit()
    return {"message": "Azienda disattivata"}


@router.post("/companies/{company_id}/add-credit")
def add_credit(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")
    company.credits += 1
    company.welcome_bonus_used = True
    sync_credits_by_vat(db, company.vat_number, company.credits)
    db.commit()
    return {"message": f"+1 credito aggiunto a {company.name}", "credits": company.credits}


@router.delete("/companies/{company_id}")
def delete_company(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")

    db.delete(company)
    db.commit()
    return {"message": "Azienda eliminata definitivamente"}


@router.get("/companies/{company_id}/jobs")
def company_jobs(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    jobs = (
        db.query(models.Job)
        .filter(models.Job.company_id == company_id)
        .order_by(models.Job.created_at.desc())
        .limit(200)
        .all()
    )
    return [
        {
            "id":              j.id,
            "status":          j.status,
            "tif_filename":    j.tif_filename,
            "panels_detected": j.panels_detected,
            "hotspot_count":   j.hotspot_count,
            "degraded_count":  j.degraded_count,
            "created_at":      j.created_at.isoformat(),
            "completed_at":    j.completed_at.isoformat() if j.completed_at else None,
        }
        for j in jobs
    ]


@router.get("/companies/{company_id}/stats")
def company_stats(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)

    total_jobs = db.query(func.count(models.Job.id)).filter(models.Job.company_id == company_id).scalar() or 0
    jobs_month = db.query(func.count(models.Job.id)).filter(
        models.Job.company_id == company_id,
        models.Job.created_at >= month_start,
    ).scalar() or 0
    completed_total = db.query(func.count(models.Job.id)).filter(
        models.Job.company_id == company_id, models.Job.status == "completato",
    ).scalar() or 0
    completed_month = db.query(func.count(models.Job.id)).filter(
        models.Job.company_id == company_id, models.Job.status == "completato",
        models.Job.created_at >= month_start,
    ).scalar() or 0
    panels_total = db.query(func.sum(models.Job.panels_detected)).filter(
        models.Job.company_id == company_id, models.Job.status == "completato",
    ).scalar() or 0
    panels_month = db.query(func.sum(models.Job.panels_detected)).filter(
        models.Job.company_id == company_id, models.Job.status == "completato",
        models.Job.created_at >= month_start,
    ).scalar() or 0

    return {
        "total_jobs": total_jobs,
        "jobs_month": jobs_month,
        "completed_total": completed_total,
        "completed_month": completed_month,
        "panels_total": panels_total,
        "panels_month": panels_month,
    }


@router.get("/companies/{company_id}/history")
def company_history(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Restituisce i job completati per mese negli ultimi 12 mesi."""
    from sqlalchemy import extract
    from datetime import datetime, timezone, timedelta

    now = datetime.now(timezone.utc)
    months = []
    for i in range(11, -1, -1):
        # calcola anno/mese per i mesi precedenti
        month_date = (now.replace(day=1) - timedelta(days=i * 28)).replace(day=1)
        year  = month_date.year
        month = month_date.month
        count = db.query(func.count(models.Job.id)).filter(
            models.Job.company_id == company_id,
            models.Job.status == "completato",
            extract("year",  models.Job.created_at) == year,
            extract("month", models.Job.created_at) == month,
        ).scalar() or 0
        months.append({
            "label": month_date.strftime("%b %Y"),
            "count": count,
        })
    return months


# ---------------------------------------------------------------------------
# Usage / Billing report
# ---------------------------------------------------------------------------

@router.get("/billing")
def billing_report(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Billing raggruppato per P.IVA: tutte le aziende sotto la stessa P.IVA appaiono come un'unica riga."""
    companies = (
        db.query(models.Company)
        .filter(
            models.Company.email != auth_utils.ADMIN_EMAIL,
            models.Company.deleted_at.is_(None),
        )
        .order_by(models.Company.created_at.asc())
        .all()
    )

    # Raggruppa per vat_number (o per id se vat_number assente)
    groups: dict[str, dict] = {}
    for c in companies:
        key = c.vat_number or str(c.id)
        if key not in groups:
            groups[key] = {
                "id":             c.id,
                "name":           c.ragione_sociale or c.name,
                "vat_number":     c.vat_number or "",
                "credits":        0,
                "jobs_completed": 0,
                "total_paid":     0.0,
                "payments":       [],
            }

        # Accumula crediti e job
        groups[key]["credits"] += c.credits

        jobs_completed = (
            db.query(func.count(models.Job.id))
            .filter(models.Job.company_id == c.id, models.Job.status == "completato")
            .scalar() or 0
        )
        groups[key]["jobs_completed"] += jobs_completed

        # Bonifici
        for b in (
            db.query(models.BonificoRequest)
            .filter(models.BonificoRequest.company_id == c.id)
            .order_by(models.BonificoRequest.created_at.desc())
            .all()
        ):
            groups[key]["payments"].append({
                "id":           f"b-{b.id}",
                "type":         "bonifico",
                "method_label": "Bonifico",
                "credits":      b.credits,
                "amount_eur":   b.amount_eur,
                "status":       b.status,
                "date":         (b.approved_at or b.created_at).isoformat(),
                "receipt_id":   b.id if b.receipt_path else None,
            })

        # Pagamenti Stripe
        for sp in (
            db.query(models.StripePayment)
            .filter(models.StripePayment.company_id == c.id)
            .order_by(models.StripePayment.created_at.desc())
            .all()
        ):
            groups[key]["payments"].append({
                "id":           f"s-{sp.id}",
                "type":         "stripe",
                "method_label": "Carta (Stripe)",
                "credits":      sp.credits,
                "amount_eur":   sp.amount_eur,
                "status":       "approved",
                "date":         sp.created_at.isoformat(),
                "receipt_id":   None,
            })

    rows = []
    for g in groups.values():
        g["payments"].sort(key=lambda p: p["date"], reverse=True)
        g["total_paid"] = round(
            sum(p["amount_eur"] for p in g["payments"] if p["status"] == "approved"), 2
        )
        rows.append(g)

    # Ordina per totale pagato desc
    rows.sort(key=lambda r: r["total_paid"], reverse=True)
    return rows


@router.get("/bonifico-requests/{req_id}/receipt")
def download_receipt(
    req_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    from fastapi.responses import RedirectResponse
    req = db.query(models.BonificoRequest).filter(models.BonificoRequest.id == req_id).first()
    if not req or not req.receipt_path:
        raise HTTPException(status_code=404, detail="Ricevuta non trovata")
    try:
        signed_url = storage_utils.get_signed_url(req.receipt_path, expires_in=300)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File non disponibile: {e}")
    return RedirectResponse(url=signed_url)


@router.get("/usage")
def usage_report(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    logs = (
        db.query(models.UsageLog)
        .order_by(models.UsageLog.created_at.desc())
        .limit(500)
        .all()
    )

    rows = []
    for log in logs:
        company = db.query(models.Company).filter(models.Company.id == log.company_id).first()
        rows.append({
            "company_name":  company.name if company else "N/A",
            "company_email": company.email if company else "N/A",
            "job_id":        log.job_id[:8] + "...",
            "panels_count":  log.panels_count,
            "credits_used":  log.credits_used,
            "cost_eur":      round(log.panels_count * PRICE_PER_PANEL, 2),
            "created_at":    log.created_at.isoformat(),
        })

    return rows


# ---------------------------------------------------------------------------
# Bonifico requests
# ---------------------------------------------------------------------------

@router.get("/bonifico-requests")
def list_bonifico_requests(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    reqs = (
        db.query(models.BonificoRequest)
        .order_by(models.BonificoRequest.created_at.desc())
        .limit(200)
        .all()
    )
    rows = []
    for r in reqs:
        company = db.query(models.Company).filter(models.Company.id == r.company_id).first()
        rows.append({
            "id":           r.id,
            "company_id":   r.company_id,
            "company_name": company.name if company else "N/A",
            "package":      r.package,
            "credits":      r.credits,
            "amount_eur":   r.amount_eur,
            "status":       r.status,
            "receipt_path": r.receipt_path,
            "created_at":   r.created_at.isoformat(),
            "approved_at":  r.approved_at.isoformat() if r.approved_at else None,
        })
    return rows


@router.post("/bonifico-requests/{req_id}/approve")
def approve_bonifico(
    req_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    req = db.query(models.BonificoRequest).filter(models.BonificoRequest.id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Richiesta già elaborata")

    company = db.query(models.Company).filter(models.Company.id == req.company_id).first()
    if company:
        company.credits += req.credits
        sync_credits_by_vat(db, company.vat_number, company.credits)

    req.status      = "approved"
    req.approved_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"+{req.credits} crediti aggiunti a {company.name if company else req.company_id}"}


@router.post("/bonifico-requests/{req_id}/reject")
def reject_bonifico(
    req_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    req = db.query(models.BonificoRequest).filter(models.BonificoRequest.id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Richiesta già elaborata")

    req.status = "rejected"
    db.commit()
    return {"message": "Richiesta rifiutata"}


# ── Reviews ─────────────────────────────────────────────────────────────────

@router.get("/reviews")
def list_reviews(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    reviews = (
        db.query(models.Review)
        .order_by(models.Review.created_at.desc())
        .all()
    )
    return [
        {
            "id":         r.id,
            "stars":      r.stars,
            "comment":    r.comment,
            "company":    (r.company.ragione_sociale if r.company else None) or "Cliente verificato",
            "status":     r.status,
            "created_at": r.created_at.isoformat(),
        }
        for r in reviews
    ]


@router.post("/reviews/{review_id}/approve")
def approve_review(
    review_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    r = db.query(models.Review).filter(models.Review.id == review_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recensione non trovata")
    r.status = "approved"
    db.commit()
    return {"message": "Recensione approvata"}


@router.post("/reviews/{review_id}/reject")
def reject_review(
    review_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    r = db.query(models.Review).filter(models.Review.id == review_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recensione non trovata")
    db.delete(r)
    db.commit()
    return {"message": "Recensione rifiutata ed eliminata"}


@router.delete("/reviews/{review_id}")
def delete_review(
    review_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    r = db.query(models.Review).filter(models.Review.id == review_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Recensione non trovata")
    db.delete(r)
    db.commit()
    return {"message": "Recensione eliminata"}


# ---------------------------------------------------------------------------
# Uploads — file caricati dagli utenti
# ---------------------------------------------------------------------------

@router.get("/uploads")
def list_uploads(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Per ogni azienda, lista tutti i job con i file caricati."""
    companies = (
        db.query(models.Company)
        .filter(
            models.Company.email != auth_utils.ADMIN_EMAIL,
            models.Company.deleted_at.is_(None),
        )
        .order_by(models.Company.created_at.desc())
        .all()
    )

    result = []
    for c in companies:
        jobs = (
            db.query(models.Job)
            .filter(models.Job.company_id == c.id)
            .order_by(models.Job.created_at.desc())
            .all()
        )

        jobs_data = []
        for j in jobs:
            files = []
            # Usa result_path se disponibile, altrimenti cerca in jobs/{job_id}/
            storage_prefix = j.result_path or f"jobs/{j.id}"
            try:
                files = storage_utils.list_files(storage_prefix)
            except Exception:
                pass

            jobs_data.append({
                "job_id":      j.id,
                "tif_filename": j.tif_filename,
                "status":      j.status,
                "created_at":  j.created_at.isoformat(),
                "files":       files,
            })

        if jobs_data:
            result.append({
                "company_id":      c.id,
                "company_name":    c.ragione_sociale or c.name or c.email,
                "company_email":   c.email,
                "jobs":            jobs_data,
            })

    return result


@router.get("/jobs/{job_id}/files/{filename}")
def download_uploaded_file(
    job_id:   str,
    filename: str,
    db:       Session = Depends(get_db),
    _:        models.Company = Depends(auth_utils.require_admin),
):
    """Scarica un file del job da Supabase Storage."""
    from fastapi.responses import RedirectResponse
    if ".." in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Nome file non valido")

    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job or not job.result_path:
        raise HTTPException(status_code=404, detail="Job non trovato")

    storage_path = f"{job.result_path}/{filename}"
    try:
        signed_url = storage_utils.get_signed_url(storage_path, expires_in=300)
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"File non disponibile: {e}")
    return RedirectResponse(url=signed_url)


# ---------------------------------------------------------------------------
# Support tickets
# ---------------------------------------------------------------------------

@router.get("/tickets")
def all_tickets(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Tutti i ticket di assistenza con info azienda."""
    tickets = (
        db.query(models.SupportTicket)
        .order_by(models.SupportTicket.created_at.desc())
        .all()
    )
    result = []
    for t in tickets:
        company = db.query(models.Company).filter(models.Company.id == t.company_id).first()
        result.append({
            "id":              t.id,
            "subject":         t.subject,
            "message":         t.message,
            "status":          t.status or "in_elaborazione",
            "created_at":      t.created_at.isoformat(),
            "company_id":      t.company_id,
            "company_name":    (company.ragione_sociale or company.name) if company else "—",
            "company_email":   company.email if company else "—",
        })
    return result


@router.get("/tickets/{ticket_id}")
def get_ticket_detail(
    ticket_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Dettaglio ticket con storico messaggi (per chat modal admin)."""
    ticket = db.query(models.SupportTicket).filter(models.SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    company = db.query(models.Company).filter(models.Company.id == ticket.company_id).first()
    return {
        "id":            ticket.id,
        "subject":       ticket.subject,
        "message":       ticket.message,
        "status":        ticket.status or "in_elaborazione",
        "created_at":    ticket.created_at.isoformat(),
        "company_name":  (company.ragione_sociale or company.name) if company else "—",
        "company_email": company.email if company else "—",
        "messages": [
            {
                "id":         m.id,
                "sender":     m.sender,
                "text":       m.text,
                "created_at": m.created_at.isoformat(),
            }
            for m in ticket.messages
        ],
    }


@router.patch("/tickets/{ticket_id}/status")
def update_ticket_status(
    ticket_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Aggiorna lo stato di un ticket. Un ticket risolto non può essere riaperto."""
    ticket = db.query(models.SupportTicket).filter(models.SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")
    if ticket.status == "risolto":
        raise HTTPException(status_code=400, detail="Il ticket è già risolto e non può essere riaperto.")
    new_status = body.get("status", "")
    if new_status not in ("in_elaborazione", "risolto"):
        raise HTTPException(status_code=400, detail="Stato non valido")
    ticket.status = new_status
    db.commit()
    # Notifica al cliente quando il ticket viene marcato come risolto
    if new_status == "risolto":
        notif = models.Notification(
            company_id=ticket.company_id,
            title=f"Segnalazione #{ticket_id} risolta",
            message="Il tuo ticket è stato chiuso dall'amministratore. Per ulteriore assistenza apri una nuova segnalazione.",
            ticket_id=ticket_id,
        )
        db.add(notif)
        db.commit()
    return {"message": "Stato aggiornato", "status": new_status}


@router.post("/tickets/{ticket_id}/reply")
def reply_ticket(
    ticket_id: int,
    body: dict,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Invia una risposta al ticket: notifica in-app + email al cliente."""
    ticket = db.query(models.SupportTicket).filter(models.SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket non trovato")

    reply_text = (body.get("reply") or "").strip()
    if not reply_text:
        raise HTTPException(status_code=400, detail="Messaggio di risposta obbligatorio")

    ticket.reply      = reply_text
    ticket.replied_at = datetime.now(timezone.utc)
    ticket.status     = "in_elaborazione"

    # Crea messaggio nella conversazione
    msg = models.TicketMessage(ticket_id=ticket_id, sender="admin", text=reply_text)
    db.add(msg)

    notif = models.Notification(
        company_id = ticket.company_id,
        title      = f"Risposta alla tua segnalazione #{ticket_id}",
        message    = reply_text[:120],
        ticket_id  = ticket_id,
    )
    db.add(notif)
    db.commit()

    # Email al cliente
    company = ticket.company
    try:
        import email_utils
        email_utils.notify_ticket_reply(
            company_email  = company.email,
            company_name   = company.ragione_sociale or company.name,
            ticket_id      = ticket_id,
            ticket_subject = ticket.subject,
            reply_text     = reply_text,
        )
    except Exception:
        pass

    return {"message": "Risposta inviata", "status": ticket.status}


@router.get("/companies/{company_id}/tickets")
def company_tickets(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    tickets = (
        db.query(models.SupportTicket)
        .filter(models.SupportTicket.company_id == company_id)
        .order_by(models.SupportTicket.created_at.desc())
        .all()
    )
    return [
        {
            "id":         t.id,
            "subject":    t.subject,
            "message":    t.message,
            "status":     t.status or "in_elaborazione",
            "created_at": t.created_at.isoformat(),
        }
        for t in tickets
    ]


# ---------------------------------------------------------------------------
# Enterprise inference logs
# ---------------------------------------------------------------------------

@router.get("/enterprise-logs")
def enterprise_logs(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Lista di tutti i clienti Enterprise che hanno avviato l'elaborazione (con consenso dati)."""
    logs = (
        db.query(models.EnterpriseInferenceLog)
        .order_by(models.EnterpriseInferenceLog.created_at.desc())
        .all()
    )
    return [
        {
            "id":              l.id,
            "company_id":      l.company_id,
            "company_name":    l.company_name,
            "company_email":   l.company_email,
            "vat_number":      l.vat_number,
            "fh_workspace_id": l.fh_workspace_id,
            "data_consent":    l.data_consent,
            "created_at":      l.created_at.isoformat(),
        }
        for l in logs
    ]


@router.get("/enterprise-logs/csv")
def enterprise_logs_csv(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Scarica tutti i log Enterprise in formato CSV."""
    import csv, io
    from fastapi.responses import StreamingResponse

    logs = (
        db.query(models.EnterpriseInferenceLog)
        .order_by(models.EnterpriseInferenceLog.created_at.desc())
        .all()
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["ID", "Company ID", "Nome", "Email", "P.IVA", "FlightHub Workspace", "Consenso dati", "Data"])
    for l in logs:
        writer.writerow([
            l.id, l.company_id, l.company_name, l.company_email,
            l.vat_number or "", l.fh_workspace_id or "",
            "Sì" if l.data_consent else "No",
            l.created_at.strftime("%Y-%m-%d %H:%M:%S"),
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=enterprise_clients.csv"},
    )


# ---------------------------------------------------------------------------
# Welcome Bonus Requests
# ---------------------------------------------------------------------------

@router.get("/welcome-bonus-requests")
def list_welcome_bonus_requests(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Elenco richieste bonus di benvenuto con info IP."""
    requests_list = (
        db.query(models.WelcomeBonusRequest)
        .join(models.Company, models.WelcomeBonusRequest.company_id == models.Company.id)
        .filter(models.Company.deleted_at.is_(None))
        .order_by(models.WelcomeBonusRequest.created_at.desc())
        .all()
    )

    # IP duplicati tra aziende attive (per colorazione)
    all_companies = db.query(models.Company).filter(
        models.Company.deleted_at.is_(None),
        models.Company.is_active == True,
        models.Company.last_ip.isnot(None),
    ).all()
    all_ips = [c.last_ip for c in all_companies if c.last_ip and c.last_ip != "—"]
    duplicate_ips = {ip for ip in all_ips if all_ips.count(ip) > 1}
    # Mappa IP -> prima azienda con quell'IP (diversa da quella corrente)
    ip_to_companies: dict = {}
    for comp in all_companies:
        if comp.last_ip and comp.last_ip != "—":
            ip_to_companies.setdefault(comp.last_ip, []).append(comp)

    result = []
    for r in requests_list:
        c = r.company
        req_ip = r.ip or c.last_ip or "—"
        is_warning = (r.ip and r.ip in duplicate_ips) or (c.last_ip and c.last_ip in duplicate_ips)
        # Trova l'altra azienda con lo stesso IP
        dup_id = None
        dup_name = None
        if is_warning:
            others = [x for x in ip_to_companies.get(req_ip, []) if x.id != c.id]
            if others:
                dup_id = others[0].id
                dup_name = others[0].ragione_sociale or others[0].name
        result.append({
            "id":                    r.id,
            "company_id":            c.id,
            "company_name":          c.ragione_sociale or c.name,
            "company_email":         c.email,
            "vat_number":            c.vat_number or "",
            "status":                r.status,
            "ip":                    req_ip,
            "ip_status":             "warning" if is_warning else "ok",
            "created_at":            r.created_at.isoformat(),
            "credits_current":       c.credits,
            "duplicate_company_id":  dup_id,
            "duplicate_company_name": dup_name,
        })
    return result


@router.post("/welcome-bonus-requests/{req_id}/approve")
def approve_welcome_bonus(
    req_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    req = db.query(models.WelcomeBonusRequest).filter(models.WelcomeBonusRequest.id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Richiesta già elaborata")

    company = db.query(models.Company).filter(models.Company.id == req.company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")

    # Aggiungi 1 credito bonus
    company.credits += 1
    company.welcome_bonus_used = True
    req.status = "approved"
    db.commit()
    return {"message": "Bonus approvato. +1 credito aggiunto.", "credits": company.credits}


@router.post("/welcome-bonus-requests/{req_id}/reject")
def reject_welcome_bonus(
    req_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    req = db.query(models.WelcomeBonusRequest).filter(models.WelcomeBonusRequest.id == req_id).first()
    if not req:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Richiesta già elaborata")

    req.status = "rejected"
    db.commit()
    return {"message": "Richiesta rifiutata"}
