import os
import uuid

import stripe
import storage_utils
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Header, HTTPException, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

import email_utils

import auth_utils
from auth_utils import sync_credits_by_vat
import models
from database import get_db, SessionLocal

router = APIRouter(prefix="/payments", tags=["Payments"])

stripe.api_key          = os.getenv("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET          = os.getenv("STRIPE_WEBHOOK_SECRET", "")
FRONTEND_URL            = os.getenv("FRONTEND_URL", "http://localhost:8000")

# Pacchetti crediti — price_id si configura in .env dopo aver creato i prezzi su Stripe
PACKAGES = {
    "single": {
        "credits":   1,
        "price_id":  os.getenv("STRIPE_PRICE_SINGLE", ""),
        "label":     "Singola",
        "price_eur": float(os.getenv("PRICE_SINGLE_EUR", "49.99")),
    },
    "pack5": {
        "credits":   5,
        "price_id":  os.getenv("STRIPE_PRICE_PACK5", ""),
        "label":     "Pack 5",
        "price_eur": float(os.getenv("PRICE_PACK5_EUR", "219.99")),
    },
    "pack10": {
        "credits":   10,
        "price_id":  os.getenv("STRIPE_PRICE_PACK10", ""),
        "label":     "Pack 10",
        "price_eur": float(os.getenv("PRICE_PACK10_EUR", "399.99")),
    },
}


class CheckoutBody(BaseModel):
    package: str  # starter | pro | enterprise


@router.get("/packages")
def get_packages():
    """Restituisce i pacchetti disponibili (senza price_id interno)."""
    return [
        {"key": k, "label": v["label"], "credits": v["credits"], "price_eur": v["price_eur"]}
        for k, v in PACKAGES.items()
    ]


@router.post("/checkout")
def create_checkout(
    body: CheckoutBody,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    if not stripe.api_key:
        raise HTTPException(
            status_code=503,
            detail="Pagamenti non ancora configurati. Contatta l'amministratore.",
        )

    pkg = PACKAGES.get(body.package)
    if not pkg:
        raise HTTPException(status_code=400, detail="Pacchetto non valido")

    if not pkg["price_id"]:
        raise HTTPException(
            status_code=503,
            detail="Pacchetto non ancora attivo. Contatta l'amministratore.",
        )

    try:
        # Crea o recupera il customer Stripe
        if not current.stripe_customer_id:
            customer = stripe.Customer.create(
                email=current.email,
                name=current.name,
            )
            current.stripe_customer_id = customer.id
            db.commit()

        session = stripe.checkout.Session.create(
            customer=current.stripe_customer_id,
            payment_method_types=["card"],
            line_items=[{"price": pkg["price_id"], "quantity": 1}],
            mode="payment",
            success_url=f"{FRONTEND_URL}/dashboard?payment=success",
            cancel_url=f"{FRONTEND_URL}/dashboard?payment=cancelled",
            metadata={
                "company_id": str(current.id),
                "credits":    str(pkg["credits"]),
                "package":    body.package,
            },
        )
        return {"checkout_url": session.url}

    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.post("/webhook")
async def stripe_webhook(
    request: Request,
    stripe_signature: str = Header(None, alias="stripe-signature"),
):
    if not WEBHOOK_SECRET:
        raise HTTPException(status_code=503, detail="Webhook non configurato")

    payload = await request.body()

    try:
        event = stripe.Webhook.construct_event(payload, stripe_signature, WEBHOOK_SECRET)
    except (ValueError, stripe.error.SignatureVerificationError):
        raise HTTPException(status_code=400, detail="Firma webhook non valida")

    if event["type"] == "checkout.session.completed":
        sess       = event["data"]["object"]
        company_id = int(sess["metadata"]["company_id"])
        credits    = int(sess["metadata"]["credits"])
        package    = sess["metadata"].get("package", "")

        db = SessionLocal()
        try:
            company = db.query(models.Company).filter(models.Company.id == company_id).first()
            if company:
                company.credits += credits
                sync_credits_by_vat(db, company.vat_number, company.credits)
                amount_eur = (sess.get("amount_total") or 0) / 100
                # Salva il pagamento Stripe nel DB
                existing = db.query(models.StripePayment).filter(
                    models.StripePayment.stripe_session == sess.get("id")
                ).first()
                if not existing:
                    sp = models.StripePayment(
                        company_id     = company_id,
                        stripe_session = sess.get("id"),
                        package        = package,
                        credits        = credits,
                        amount_eur     = amount_eur,
                    )
                    db.add(sp)
                db.commit()
                email_utils.notify_stripe_payment(
                    company_name=company.ragione_sociale or company.name,
                    company_email=company.email,
                    package=package,
                    amount_eur=amount_eur,
                    credits=credits,
                )
        finally:
            db.close()

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Bonifico requests
# ---------------------------------------------------------------------------

@router.post("/bonifico-request", status_code=201)
async def bonifico_request(
    background_tasks: BackgroundTasks,
    package: str = Form(...),
    receipt: UploadFile = File(...),
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    pkg = PACKAGES.get(package)
    if not pkg:
        raise HTTPException(status_code=400, detail="Pacchetto non valido")

    # Valida tipo file
    allowed = {"image/jpeg", "image/png", "image/webp", "application/pdf"}
    if receipt.content_type not in allowed:
        raise HTTPException(status_code=400, detail="Formato non supportato. Usa JPG, PNG o PDF.")

    # Carica ricevuta su Supabase Storage
    ext = os.path.splitext(receipt.filename)[-1] or ".jpg"
    filename = f"{current.id}_{uuid.uuid4().hex}{ext}"
    storage_path = f"ricevute/{filename}"
    data = await receipt.read()
    try:
        storage_utils.upload_bytes(data, storage_path, receipt.content_type or "application/octet-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Errore upload ricevuta: {e}")

    req = models.BonificoRequest(
        company_id   = current.id,
        package      = package,
        credits      = pkg["credits"],
        amount_eur   = pkg["price_eur"],
        status       = "pending",
        receipt_path = storage_path,   # path su Supabase, non locale
    )
    db.add(req)
    db.commit()

    # Notifica email all'admin in background
    background_tasks.add_task(
        email_utils.notify_bonifico,
        current.name,
        current.email,
        package,
        pkg["price_eur"],
        pkg["credits"],
    )

    return {"message": "Richiesta registrata. I crediti verranno accreditati dopo verifica del pagamento."}
