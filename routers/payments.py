import os

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import auth_utils
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
        "price_eur": float(os.getenv("PRICE_SINGLE_EUR", "15.00")),
    },
    "pack5": {
        "credits":   5,
        "price_id":  os.getenv("STRIPE_PRICE_PACK5", ""),
        "label":     "Pack 5",
        "price_eur": float(os.getenv("PRICE_PACK5_EUR", "65.00")),
    },
    "pack10": {
        "credits":   10,
        "price_id":  os.getenv("STRIPE_PRICE_PACK10", ""),
        "label":     "Pack 10",
        "price_eur": float(os.getenv("PRICE_PACK10_EUR", "120.00")),
    },
    "pack20": {
        "credits":   20,
        "price_id":  os.getenv("STRIPE_PRICE_PACK20", ""),
        "label":     "Pack 20",
        "price_eur": float(os.getenv("PRICE_PACK20_EUR", "220.00")),
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
            success_url=f"{FRONTEND_URL}/static/dashboard.html?payment=success",
            cancel_url=f"{FRONTEND_URL}/static/dashboard.html?payment=cancelled",
            metadata={
                "company_id": str(current.id),
                "credits":    str(pkg["credits"]),
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

        db = SessionLocal()
        try:
            company = db.query(models.Company).filter(models.Company.id == company_id).first()
            if company:
                company.credits += credits
                db.commit()
        finally:
            db.close()

    return {"status": "ok"}
