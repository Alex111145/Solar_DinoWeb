import os
from datetime import datetime, timezone
from typing import Optional, Literal

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

import auth_utils
import models
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
        .filter(models.Company.email != auth_utils.ADMIN_EMAIL)
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

    now         = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    panels_month = (
        db.query(func.sum(models.Job.panels_detected))
        .filter(models.Job.status == "completato", models.Job.created_at >= month_start)
        .scalar()
    ) or 0

    return {
        "total_companies":       total_companies,
        "total_jobs":            total_jobs,
        "completed_jobs":        completed,
        "total_panels_detected": total_panels,
        "total_revenue_eur":     round(total_panels  * PRICE_PER_PANEL, 2),
        "revenue_month_eur":     round(panels_month  * PRICE_PER_PANEL, 2),
        "price_per_panel":       PRICE_PER_PANEL,
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
            "last_ip":          c.last_ip or "—",
            "created_at":       c.created_at.isoformat(),
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


@router.delete("/companies/{company_id}")
def delete_company(
    company_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    company = db.query(models.Company).filter(models.Company.id == company_id).first()
    if not company:
        raise HTTPException(status_code=404, detail="Azienda non trovata")

    company.deleted_at = datetime.now(timezone.utc)
    company.is_active  = False
    db.commit()
    return {"message": "Azienda eliminata (soft delete)"}


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
    """Per ogni azienda: pannelli totali, importo dovuto, pagamenti ricevuti con metodo."""
    companies = (
        db.query(models.Company)
        .filter(
            models.Company.email != auth_utils.ADMIN_EMAIL,
            models.Company.deleted_at.is_(None),
        )
        .order_by(models.Company.created_at.desc())
        .all()
    )

    rows = []
    for c in companies:
        panels_total = db.query(func.sum(models.Job.panels_detected)).filter(
            models.Job.company_id == c.id,
            models.Job.status == "completato",
        ).scalar() or 0

        amount_due = round(panels_total * PRICE_PER_PANEL, 2)

        # Pagamenti ricevuti: bonifici approvati
        bonifici = db.query(models.BonificoRequest).filter(
            models.BonificoRequest.company_id == c.id,
            models.BonificoRequest.status == "approved",
        ).order_by(models.BonificoRequest.approved_at.desc()).all()

        payments = [{
            "id":           b.id,
            "method":       "Bonifico",
            "credits":      b.credits,
            "amount_eur":   b.amount_eur,
            "date":         b.approved_at.isoformat() if b.approved_at else b.created_at.isoformat(),
            "has_receipt":  bool(b.receipt_path and os.path.exists(b.receipt_path)),
        } for b in bonifici]

        rows.append({
            "id":            c.id,
            "name":          c.name,
            "email":         c.email,
            "panels_total":  panels_total,
            "amount_due":    amount_due,
            "payments":      payments,
        })

    return rows


@router.get("/bonifico-requests/{req_id}/receipt")
def download_receipt(
    req_id: int,
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    req = db.query(models.BonificoRequest).filter(models.BonificoRequest.id == req_id).first()
    if not req or not req.receipt_path:
        raise HTTPException(status_code=404, detail="Ricevuta non trovata")
    if not os.path.exists(req.receipt_path):
        raise HTTPException(status_code=404, detail="File ricevuta non trovato")
    return FileResponse(path=req.receipt_path, filename=os.path.basename(req.receipt_path))


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
            job_dir = os.path.join(UPLOAD_DIR, j.id)
            files = []
            if os.path.isdir(job_dir):
                for fname in sorted(os.listdir(job_dir)):
                    fpath = os.path.join(job_dir, fname)
                    if os.path.isfile(fpath):
                        size_mb = round(os.path.getsize(fpath) / (1024 * 1024), 2)
                        files.append({"name": fname, "size_mb": size_mb})

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
    """Scarica un file originale caricato dall'utente."""
    # sicurezza: blocca path traversal
    if ".." in filename or "/" in filename or "\\" in filename:
        raise HTTPException(status_code=400, detail="Nome file non valido")

    job = db.query(models.Job).filter(models.Job.id == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job non trovato")

    file_path = os.path.join(UPLOAD_DIR, job_id, filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File non trovato")

    return FileResponse(path=file_path, filename=filename)


# ---------------------------------------------------------------------------
# Enterprise inference logs
# ---------------------------------------------------------------------------

@router.get("/enterprise-logs")
def enterprise_logs(
    db: Session = Depends(get_db),
    _: models.Company = Depends(auth_utils.require_admin),
):
    """Lista di tutti i clienti Enterprise che hanno avviato l'inferenza (con consenso dati)."""
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
