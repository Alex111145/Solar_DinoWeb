import os
from datetime import datetime, timezone, timedelta
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func, text
from sqlalchemy.orm import Session

import auth_utils
from auth_utils import sync_credits_by_vat
import models
import storage_utils
from database import get_db

router = APIRouter(prefix="/sys-ctrl", tags=["Admin"])

PRICE_PER_PANEL      = float(os.getenv("PRICE_PER_PANEL", "0.01"))      # € per pannello rilevato
UPLOAD_DIR           = os.getenv("UPLOAD_DIR", "elaborazioni")
RUNPOD_COST_PER_SEC  = float(os.getenv("RUNPOD_COST_PER_SEC", "0.000306"))  # € per secondo GPU (default NVIDIA A10 ~$0.000306/s)


# ---------------------------------------------------------------------------
# Stats
# ---------------------------------------------------------------------------

@router.get("/stats")
def get_stats(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    total_companies = (
        db.query(func.count(models.Company.id))
        .filter(
            models.Company._priv == False,
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

    # Fatturato mese corrente = tutti i pagamenti Stripe + bonifica approvati negli ultimi 30 gg
    revenue_stripe_month = (
        db.query(func.sum(models.StripePayment.amount_eur))
        .filter(models.StripePayment.created_at >= last_30_days)
        .scalar()
    ) or 0
    revenue_bonif_month = (
        db.query(func.sum(models.BonificoRequest.amount_eur))
        .filter(
            models.BonificoRequest.status == "approved",
            models.BonificoRequest.approved_at >= last_30_days,
        )
        .scalar()
    ) or 0
    revenue_current_month = revenue_stripe_month + revenue_bonif_month

    # Costo GPU ultimo mese = job completati negli ultimi 30 gg
    jobs_last_month = (
        db.query(models.Job)
        .filter(
            models.Job.status == "completato",
            models.Job.completed_at.isnot(None),
            models.Job.completed_at >= last_30_days,
        )
        .all()
    )
    gpu_cost_month = sum(
        max((j.completed_at - j.created_at).total_seconds(), 0.0) * RUNPOD_COST_PER_SEC
        for j in jobs_last_month
    )

    # Costo GPU totale dall'inizio (tutti i job completati)
    all_jobs = (
        db.query(models.Job)
        .filter(models.Job.status == "completato", models.Job.completed_at.isnot(None))
        .all()
    )
    total_gpu_cost = sum(
        max((j.completed_at - j.created_at).total_seconds(), 0.0) * RUNPOD_COST_PER_SEC
        for j in all_jobs
    )

    return {
        "active_companies":        total_companies,
        "total_jobs":              total_jobs,
        "completed_jobs":          completed,
        "total_panels_detected":   total_panels,
        "total_revenue_eur":       round(total_revenue, 2),
        "revenue_month_eur":       round(revenue_current_month, 2),
        "gpu_cost_month_eur":      round(gpu_cost_month, 4),
        "total_gpu_cost_eur":      round(total_gpu_cost, 4),
        "price_per_panel":         PRICE_PER_PANEL,
    }


# ---------------------------------------------------------------------------
# Companies CRUD
# ---------------------------------------------------------------------------

@router.get("/companies")
def list_companies(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    companies = (
        db.query(models.Company)
        .filter(
            models.Company._priv == False,
            models.Company.deleted_at.is_(None),
        )
        .order_by(models.Company.created_at.desc())
        .all()
    )

    # Trova IP duplicati in memoria (no query extra)
    all_ips = [c.last_ip for c in companies if c.last_ip and c.last_ip != "—" and c.is_active]
    from collections import Counter
    ip_counts = Counter(all_ips)
    duplicate_ips = {ip for ip, cnt in ip_counts.items() if cnt > 1}

    # Aggrega jobs/panels/gpu in 3 query totali invece di N*2
    job_stats = (
        db.query(
            models.Job.company_id,
            func.count(models.Job.id).label("jobs_done"),
            func.coalesce(func.sum(models.Job.panels_detected), 0).label("panels"),
        )
        .filter(models.Job.status == "completato")
        .group_by(models.Job.company_id)
        .all()
    )
    jobs_map    = {r.company_id: r.jobs_done for r in job_stats}
    panels_map  = {r.company_id: r.panels    for r in job_stats}

    gpu_jobs = (
        db.query(models.Job.company_id, models.Job.created_at, models.Job.completed_at)
        .filter(models.Job.status == "completato", models.Job.completed_at.isnot(None))
        .all()
    )
    gpu_cost_map: dict = {}
    for j in gpu_jobs:
        secs = max((j.completed_at - j.created_at).total_seconds(), 0.0)
        gpu_cost_map[j.company_id] = gpu_cost_map.get(j.company_id, 0.0) + secs

    result = []
    for c in companies:
        panels       = panels_map.get(c.id, 0)
        gpu_cost_eur = round(gpu_cost_map.get(c.id, 0.0) * RUNPOD_COST_PER_SEC, 4)
        result.append({
            "id":               c.id,
            "name":             c.name,
            "ragione_sociale":  c.ragione_sociale or "",
            "vat_number":       "",
            "email":            c.email,
            "credits":          c.credits,
            "is_active":        c.is_active,
            "jobs_completed":   jobs_map.get(c.id, 0),
            "panels_detected":  panels,
            "amount_owed_eur":  round(panels * PRICE_PER_PANEL, 2),
            "last_ip":              c.last_ip or "—",
            "ip_status":            "warning" if c.is_active and c.last_ip and c.last_ip in duplicate_ips else "ok",
            "welcome_bonus_used":   bool(c.welcome_bonus_used),
            "last_login_at":        c.last_login_at.isoformat() if c.last_login_at else None,
            "created_at":           c.created_at.isoformat(),
            "subscription_active":  bool(c.subscription_active),
            "subscription_plan":    c.subscription_plan,
            "subscription_start_date": c.subscription_start_date.strftime("%d/%m/%Y") if c.subscription_start_date else None,
            "subscription_end_date":   c.subscription_end_date.strftime("%d/%m/%Y") if c.subscription_end_date else None,
            "gpu_cost_eur":            gpu_cost_eur,
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")

    if body.is_active is not None:
        company.is_active = body.is_active
    if body.credits is not None:
        company.credits = body.credits
        sync_credits_by_vat(db, None, body.credits, company.ragione_sociale)
    if body.name:
        company.name = body.name.strip()

    db.commit()
    return {"message": "Azienda aggiornata"}


@router.post("/companies/{company_id}/activate")
def activate_company(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
):
    company = (
        db.query(models.Company)
        .filter(models.Company.id == company_id)
        .with_for_update()
        .first()
    )
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")
    company.credits += 1
    sync_credits_by_vat(db, company.vat_number, company.credits, company.ragione_sociale)
    db.add(models.Notification(
        company_id=company.id,
        title="🎁 Elaborazione gratuita in regalo!",
        message="Complimenti! Sei stato selezionato per ricevere un'elaborazione gratuita. Il credito è già disponibile nel tuo account.",
    ))
    db.commit()
    return {"message": f"+1 credito aggiunto a {company.name}", "credits": company.credits}


@router.delete("/companies/{company_id}")
def delete_company(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")
    if company._priv:
        raise HTTPException(status_code=403, detail="L'account amministratore non può essere eliminato.")

    company.deleted_at = datetime.now(timezone.utc)
    company.is_active  = False
    db.commit()
    return {"message": "Azienda eliminata definitivamente"}


@router.get("/companies/{company_id}/jobs")
def company_jobs(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Billing raggruppato per P.IVA: tutte le aziende sotto la stessa P.IVA appaiono come un'unica riga."""
    companies = (
        db.query(models.Company)
        .filter(
            models.Company._priv == False,
            models.Company.deleted_at.is_(None),
        )
        .order_by(models.Company.created_at.asc())
        .all()
    )

    # Raggruppa per ragione sociale (o per id se assente)
    groups: dict[str, dict] = {}
    for c in companies:
        key = (c.ragione_sociale or "").strip().lower() or str(c.id)
        if key not in groups:
            groups[key] = {
                "id":             c.id,
                "name":           c.ragione_sociale or c.name,
                "vat_number":     "",
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
    _: models.Company = Depends(auth_utils._verify_priv),
):
    from fastapi.responses import RedirectResponse
    req = db.query(models.BonificoRequest).filter(models.BonificoRequest.id == req_id).first()
    if not req or not req.receipt_path:
        raise HTTPException(status_code=404, detail="Ricevuta non trovata")
    try:
        signed_url = storage_utils.get_signed_url(req.receipt_path, expires_in=300)
    except Exception:
        raise HTTPException(status_code=404, detail="File non disponibile")
    return RedirectResponse(url=signed_url)


@router.get("/usage")
def usage_report(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
):
    req = (
        db.query(models.BonificoRequest)
        .filter(models.BonificoRequest.id == req_id)
        .with_for_update()
        .first()
    )
    if not req:
        raise HTTPException(status_code=404, detail="Richiesta non trovata")
    if req.status != "pending":
        raise HTTPException(status_code=400, detail="Richiesta già elaborata")

    company = (
        db.query(models.Company)
        .filter(models.Company.id == req.company_id)
        .with_for_update()
        .first()
    )
    if company:
        company.credits += req.credits
        sync_credits_by_vat(db, None, company.credits, company.ragione_sociale)

    req.status      = "approved"
    req.approved_at = datetime.now(timezone.utc)
    db.commit()
    return {"message": f"+{req.credits} crediti aggiunti a {company.name if company else req.company_id}"}


@router.post("/bonifico-requests/{req_id}/reject")
def reject_bonifico(
    req_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Per ogni azienda, lista tutti i job con i file caricati."""
    companies = (
        db.query(models.Company)
        .filter(
            models.Company._priv == False,
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
    _:        models.Company = Depends(auth_utils._verify_priv),
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
    except Exception:
        raise HTTPException(status_code=404, detail="File non disponibile")
    return RedirectResponse(url=signed_url)


# ---------------------------------------------------------------------------
# Support tickets
# ---------------------------------------------------------------------------

@router.get("/tickets")
def all_tickets(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Tutti i ticket di assistenza con info azienda."""
    tickets = (
        db.query(models.SupportTicket)
        .order_by(models.SupportTicket.created_at.desc())
        .limit(1000)
        .all()
    )
    result = []
    for t in tickets:
        company = db.query(models.Company).filter(models.Company.id == t.company_id).first()
        last_sender = t.messages[-1].sender if t.messages else "client"
        result.append({
            "id":              t.id,
            "subject":         t.subject,
            "message":         t.message,
            "status":          t.status or "in_elaborazione",
            "created_at":      t.created_at.isoformat(),
            "company_id":      t.company_id,
            "company_name":    (company.ragione_sociale or company.name) if company else "—",
            "company_email":   company.email if company else "—",
            "last_sender":     last_sender,
        })
    return result


@router.get("/tickets/{ticket_id}")
def get_ticket_detail(
    ticket_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
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
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Lista di tutti i clienti Enterprise che hanno avviato l'elaborazione (con consenso dati)."""
    logs = (
        db.query(models.EnterpriseInferenceLog)
        .order_by(models.EnterpriseInferenceLog.created_at.desc())
        .limit(1000)
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
    _: models.Company = Depends(auth_utils._verify_priv),
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

# ---------------------------------------------------------------------------
# GPU costs
# ---------------------------------------------------------------------------

@router.get("/gpu-costs")
def gpu_costs(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Costo GPU stimato per azienda basato sulla durata dei job completati."""
    from collections import defaultdict

    jobs = (
        db.query(models.Job)
        .filter(
            models.Job.status == "completato",
            models.Job.completed_at.isnot(None),
        )
        .all()
    )

    data: dict = defaultdict(lambda: {"job_count": 0, "total_seconds": 0.0, "jobs": []})
    for job in jobs:
        seconds = max((job.completed_at - job.created_at).total_seconds(), 0.0)
        data[job.company_id]["job_count"] += 1
        data[job.company_id]["total_seconds"] += seconds
        data[job.company_id]["jobs"].append({
            "job_id":     job.id[:8] if job.id else "—",
            "created_at": job.created_at.isoformat(),
            "seconds":    round(seconds),
            "cost_eur":   round(seconds * RUNPOD_COST_PER_SEC, 4),
        })

    company_ids = list(data.keys())
    companies_map = {
        c.id: c
        for c in db.query(models.Company).filter(models.Company.id.in_(company_ids)).all()
    }

    rows = []
    for company_id, d in data.items():
        c = companies_map.get(company_id)
        jobs_sorted = sorted(d["jobs"], key=lambda j: j["created_at"], reverse=True)
        rows.append({
            "company_id":    company_id,
            "company_name":  (c.ragione_sociale or c.name) if c else "N/A",
            "company_email": c.email if c else "N/A",
            "job_count":     d["job_count"],
            "total_seconds": round(d["total_seconds"]),
            "cost_eur":      round(d["total_seconds"] * RUNPOD_COST_PER_SEC, 4),
            "jobs":          jobs_sorted,
        })

    rows.sort(key=lambda r: r["cost_eur"], reverse=True)
    return rows


@router.get("/gpu-costs/{company_id}")
def gpu_cost_detail(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Dettaglio job GPU per singola azienda."""
    jobs = (
        db.query(models.Job)
        .filter(
            models.Job.company_id == company_id,
            models.Job.status == "completato",
            models.Job.completed_at.isnot(None),
        )
        .order_by(models.Job.completed_at.desc())
        .all()
    )
    return [
        {
            "job_id":       str(j.id),
            "created_at":   j.created_at.isoformat(),
            "completed_at": j.completed_at.isoformat(),
            "seconds":      round(max((j.completed_at - j.created_at).total_seconds(), 0.0), 1),
            "cost_eur":     round(max((j.completed_at - j.created_at).total_seconds(), 0.0) * RUNPOD_COST_PER_SEC, 6),
        }
        for j in jobs
    ]


@router.get("/monthly-summary")
def monthly_summary(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Riepilogo mensile (ultimi 12 mesi): fatturato + costo GPU."""
    from dateutil.relativedelta import relativedelta
    now = datetime.now(timezone.utc)
    result = []
    for i in range(11, -1, -1):
        month_start = (now - relativedelta(months=i)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        month_end   = month_start + relativedelta(months=1)

        stripe_rev = (
            db.query(func.sum(models.StripePayment.amount_eur))
            .filter(
                models.StripePayment.created_at >= month_start,
                models.StripePayment.created_at < month_end,
            )
            .scalar()
        ) or 0
        bonif_rev = (
            db.query(func.sum(models.BonificoRequest.amount_eur))
            .filter(
                models.BonificoRequest.status == "approved",
                models.BonificoRequest.created_at >= month_start,
                models.BonificoRequest.created_at < month_end,
            )
            .scalar()
        ) or 0

        month_jobs = (
            db.query(models.Job)
            .filter(
                models.Job.status == "completato",
                models.Job.completed_at.isnot(None),
                models.Job.completed_at >= month_start,
                models.Job.completed_at < month_end,
            )
            .all()
        )
        gpu_cost = sum(
            max((j.completed_at - j.created_at).total_seconds(), 0.0) * RUNPOD_COST_PER_SEC
            for j in month_jobs
        )

        result.append({
            "month":       month_start.strftime("%Y-%m"),
            "label":       month_start.strftime("%b %y"),
            "revenue_eur": round(float(stripe_rev + bonif_rev), 2),
            "gpu_cost_eur": round(gpu_cost, 4),
        })
    return result


# ---------------------------------------------------------------------------
# Monthly P&L stats (per grafico)
# ---------------------------------------------------------------------------

@router.get("/monthly-stats")
def monthly_stats(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Revenue e costo GPU mensili (ultimi 12 mesi) per grafico P&L."""
    now = datetime.now(timezone.utc)
    result = []
    for i in range(11, -1, -1):
        year  = now.year
        month = now.month - i
        while month <= 0:
            month += 12
            year  -= 1
        if month == 12:
            next_y, next_m = year + 1, 1
        else:
            next_y, next_m = year, month + 1
        month_start = datetime(year, month, 1, tzinfo=timezone.utc)
        month_end   = datetime(next_y, next_m, 1, tzinfo=timezone.utc)

        stripe_rev = (
            db.query(func.sum(models.StripePayment.amount_eur))
            .filter(
                models.StripePayment.created_at >= month_start,
                models.StripePayment.created_at <  month_end,
            )
            .scalar()
        ) or 0.0

        bonif_rev = (
            db.query(func.sum(models.BonificoRequest.amount_eur))
            .filter(
                models.BonificoRequest.status == "approved",
                models.BonificoRequest.approved_at >= month_start,
                models.BonificoRequest.approved_at <  month_end,
            )
            .scalar()
        ) or 0.0

        gpu_jobs = (
            db.query(models.Job)
            .filter(
                models.Job.status == "completato",
                models.Job.completed_at >= month_start,
                models.Job.completed_at <  month_end,
            )
            .all()
        )
        gpu_cost = sum(
            max((j.completed_at - j.created_at).total_seconds(), 0.0) * RUNPOD_COST_PER_SEC
            for j in gpu_jobs
        )

        result.append({
            "label":    month_start.strftime("%b %Y"),
            "year":     year,
            "month":    month,
            "revenue":  round(stripe_rev + bonif_rev, 2),
            "gpu_cost": round(gpu_cost, 4),
        })

    return result


# ---------------------------------------------------------------------------
# Supabase Storage info
# ---------------------------------------------------------------------------

@router.get("/db-size")
def db_size_info(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Ritorna la dimensione attuale del database PostgreSQL in MB."""
    try:
        result = db.execute(
            text("SELECT pg_database_size(current_database())")
        ).scalar()
        used_mb = round((result or 0) / (1024 * 1024), 2)
    except Exception:
        used_mb = 0.0
    return {"used_mb": used_mb}


@router.get("/supabase-storage")
def supabase_storage_info(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Calcola lo spazio usato su Supabase Storage sommando tutti i file dei job."""
    jobs = db.query(models.Job).filter(models.Job.status == "completato").all()
    total_mb = 0.0
    file_count = 0
    for j in jobs:
        prefix = j.result_path or f"jobs/{j.id}"
        try:
            files = storage_utils.list_files(prefix)
            for f in files:
                total_mb += f.get("size_mb", 0) or 0
                file_count += 1
        except Exception:
            pass
    return {
        "used_mb":    round(total_mb, 2),
        "file_count": file_count,
    }


@router.get("/cleanup-preview")
def cleanup_preview(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Anteprima dei file dei 10 job più vecchi con URL di download firmati."""
    SKIP_EXTENSIONS = {".pth", ".mp4", ".mov", ".avi", ".mkv", ".webm"}
    jobs = (
        db.query(models.Job)
        .filter(models.Job.status == "completato")
        .order_by(models.Job.created_at.asc())
        .limit(10)
        .all()
    )
    company_ids = {j.company_id for j in jobs}
    companies_map = {c.id: c for c in db.query(models.Company).filter(models.Company.id.in_(company_ids)).all()}

    result = []
    for j in jobs:
        prefix = j.result_path or f"jobs/{j.id}"
        c = companies_map.get(j.company_id)
        try:
            files = storage_utils.list_files(prefix)
        except Exception:
            files = []
        files_with_urls = []
        for f in files:
            fname = f.get("name", "")
            ext = os.path.splitext(fname)[1].lower()
            if ext in SKIP_EXTENSIONS:
                continue
            try:
                url = storage_utils.get_signed_url(f"{prefix}/{fname}", expires_in=3600)
            except Exception:
                url = None
            files_with_urls.append({"name": fname, "size_mb": f.get("size_mb", 0), "url": url})
        result.append({
            "job_id":       j.id,
            "company_name": (c.ragione_sociale or c.name) if c else "N/A",
            "created_at":   j.created_at.isoformat(),
            "files":        files_with_urls,
        })
    return result


@router.post("/cleanup-oldest")
def cleanup_oldest_jobs(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils._verify_priv),
):
    """Elimina i file Supabase dei 10 job più vecchi (esclusi model_best.pth e video)."""
    SKIP_EXTENSIONS = {".pth", ".mp4", ".mov", ".avi", ".mkv", ".webm"}
    jobs = (
        db.query(models.Job)
        .filter(models.Job.status == "completato")
        .order_by(models.Job.created_at.asc())
        .limit(10)
        .all()
    )
    deleted_files = 0
    freed_mb = 0.0
    for j in jobs:
        prefix = j.result_path or f"jobs/{j.id}"
        try:
            files = storage_utils.list_files(prefix)
            paths_to_delete = []
            for f in files:
                fname = f.get("name", "")
                ext = os.path.splitext(fname)[1].lower()
                if ext in SKIP_EXTENSIONS:
                    continue
                paths_to_delete.append(f"{prefix}/{fname}")
                freed_mb += f.get("size_mb", 0)
            if paths_to_delete:
                storage_utils.delete_files(paths_to_delete)
                deleted_files += len(paths_to_delete)
        except Exception:
            pass
    return {"deleted_files": deleted_files, "freed_mb": round(freed_mb, 2)}
