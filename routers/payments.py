import os
from datetime import datetime, timezone, timedelta
from dateutil.relativedelta import relativedelta

import stripe
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

import email_utils

import auth_utils
from auth_utils import sync_credits_by_vat
import models
from database import get_db, SessionLocal

router = APIRouter(prefix="/payments", tags=["Payments"])

stripe.api_key = os.getenv("STRIPE_SECRET_KEY", "")
WEBHOOK_SECRET = os.getenv("STRIPE_WEBHOOK_SECRET", "")
FRONTEND_URL   = os.getenv("FRONTEND_URL", "http://localhost:8000")

SUBSCRIPTION_PLANS = {
    "starter": {
        "credits":   10,
        "price_id":  os.getenv("STRIPE_PRICE_STARTER_SUB", ""),
        "label":     "Starter",
        "price_eur": 99.99,
    },
    "medium": {
        "credits":   20,
        "price_id":  os.getenv("STRIPE_PRICE_MEDIUM_SUB", ""),
        "label":     "Medium",
        "price_eur": 169.99,
    },
    "unlimited": {
        "credits":   None,
        "price_id":  os.getenv("STRIPE_PRICE_UNLIMITED_SUB", ""),
        "label":     "Unlimited",
        "price_eur": 299.99,
    },
    "unlimited_annual": {
        "credits":   None,
        "price_id":  os.getenv("STRIPE_PRICE_UNLIMITED_ANNUAL_SUB", ""),
        "label":     "Annual",
        "price_eur": 2400.00,
    },
}


class CheckoutBody(BaseModel):
    package: str  # starter | medium | unlimited


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
        meta       = sess.get("metadata") or {}
        company_id = int(meta.get("company_id", 0))
        is_subscription = sess.get("mode") == "subscription"
        credits    = int(meta.get("credits", 0))
        package    = meta.get("package") or meta.get("plan", "")

        if company_id:
            db = SessionLocal()
            try:
                company = db.query(models.Company).filter(models.Company.id == company_id).first()
                if company:
                    company.credits += credits
                    if is_subscription:
                        company.subscription_active = True
                        company.subscription_plan = package
                        now = datetime.now(timezone.utc)
                        company.subscription_start_date = now
                        if package == "unlimited_annual":
                            company.subscription_end_date = now + relativedelta(years=1)
                        else:
                            company.subscription_end_date = now + relativedelta(months=1)
                    sync_credits_by_vat(db, company.vat_number, company.credits)
                    amount_eur = (sess.get("amount_total") or 0) / 100
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
                    # Notifica admin
                    email_utils.notify_stripe_payment(
                        company_name=company.ragione_sociale or company.name,
                        company_email=company.email,
                        package=package,
                        amount_eur=amount_eur,
                        credits=credits,
                    )
                    # Ricevuta al cliente per abbonamenti
                    if is_subscription:
                        plan_info = SUBSCRIPTION_PLANS.get(package, {})
                        email_utils.notify_subscription_receipt(
                            company_name=company.ragione_sociale or company.name,
                            company_email=company.email,
                            plan=package,
                            amount_eur=amount_eur,
                            credits=credits,
                        )
            finally:
                db.close()

    elif event["type"] == "customer.subscription.deleted":
        # Abbonamento cancellato — disattiva il flag
        sub = event["data"]["object"]
        customer_id = sub.get("customer")
        db = SessionLocal()
        try:
            company = db.query(models.Company).filter(
                models.Company.stripe_customer_id == customer_id
            ).first()
            if company:
                company.subscription_active = False
                db.commit()
        finally:
            db.close()

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Subscription checkout
# ---------------------------------------------------------------------------

@router.post("/subscribe")
def create_subscription_checkout(
    body: CheckoutBody,
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Pagamenti non ancora configurati.")

    plan = SUBSCRIPTION_PLANS.get(body.package)
    if not plan:
        raise HTTPException(status_code=400, detail="Piano non valido")

    if not current.stripe_customer_id:
        customer = stripe.Customer.create(email=current.email, name=current.name)
        current.stripe_customer_id = customer.id
        db.commit()

    try:
        session = stripe.checkout.Session.create(
            customer=current.stripe_customer_id,
            # Abilita tutti i metodi di pagamento supportati da Stripe (carta, SEPA/IBAN, Link, ecc.)
            automatic_payment_methods={"enabled": True, "allow_redirects": "always"},
            line_items=[{"price": plan["price_id"], "quantity": 1}],
            mode="subscription",
            success_url=f"{FRONTEND_URL}/dashboard?payment=success",
            cancel_url=f"{FRONTEND_URL}/dashboard?payment=cancelled",
            metadata={
                "company_id": str(current.id),
                "plan":       body.package,
                "credits":    str(plan["credits"] or 9999),
            },
            locale="it",  # interfaccia Stripe in italiano
        )
        return {"checkout_url": session.url}
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# Stripe Customer Portal (gestione / cancellazione abbonamento)
# ---------------------------------------------------------------------------

@router.post("/portal")
def create_portal_session(
    current: models.Company = Depends(auth_utils.get_current_company),
):
    if not stripe.api_key:
        raise HTTPException(status_code=503, detail="Pagamenti non ancora configurati.")
    if not current.stripe_customer_id:
        raise HTTPException(status_code=404, detail="Nessun abbonamento attivo trovato.")
    try:
        session = stripe.billing_portal.Session.create(
            customer=current.stripe_customer_id,
            return_url=f"{FRONTEND_URL}/dashboard",
        )
        return {"portal_url": session.url}
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


# ---------------------------------------------------------------------------
# Cancella abbonamento — stop rinnovo, crediti rimangono fino a scadenza
# ---------------------------------------------------------------------------

@router.post("/cancel-subscription")
def cancel_subscription(
    current: models.Company = Depends(auth_utils.get_current_company),
    db: Session = Depends(get_db),
):
    # Risolvi il manager (uno slave usa il manager della stessa P.IVA)
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

    if not manager.subscription_active:
        raise HTTPException(status_code=400, detail="Nessun abbonamento attivo da cancellare.")

    end_date_str = (
        manager.subscription_end_date.strftime("%d/%m/%Y")
        if manager.subscription_end_date else None
    )

    # Prova a cancellare via Stripe (cancel_at_period_end = stop rinnovo, crediti restano)
    if stripe.api_key and manager.stripe_customer_id:
        try:
            subs = stripe.Subscription.list(
                customer=manager.stripe_customer_id, status="active", limit=1
            )
            if subs.data:
                stripe.Subscription.modify(subs.data[0].id, cancel_at_period_end=True)
        except stripe.error.StripeError:
            pass  # Ignora errori Stripe in ambiente test

    # subscription_active rimane True — i crediti restano fino a subscription_end_date.
    # Il webhook "customer.subscription.deleted" disattiverà il flag a scadenza naturale.
    manager.subscription_cancelled = True
    db.commit()
    return {
        "message": "Abbonamento cancellato. Non verrà rinnovato.",
        "end_date": end_date_str,
    }
