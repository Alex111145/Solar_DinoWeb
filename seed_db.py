"""
Seed script: cancella tutte le aziende non-admin e ricrea dati di test.
Crea anche elaborazioni completate per Marco Ferretti.

Usage:  python seed_db.py
"""
import os
import sys
import uuid
import random
from datetime import datetime, timedelta, timezone
from dateutil.relativedelta import relativedelta

from dotenv import load_dotenv
load_dotenv(override=True)

# Importa dopo load_dotenv così DATABASE_URL è già disponibile
from database import SessionLocal
import models
from auth_utils import hash_password

ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "agervasini1@gmail.com")

# ── Aziende da creare ──────────────────────────────────────────────────────────
TEST_COMPANIES = [
    {
        "email":             "rossi.solar@test.com",
        "name":              "Rossi Solar Srl",
        "ragione_sociale":   "Rossi Solar S.r.l.",
        "vat_number":        "IT01234567890",
        "password":          "Test1234!",
        "credits":           0,
        "subscription_active": False,
        "is_active":         True,
        "is_manager":        True,
    },
    {
        "email":             "bianchi.impianti@test.com",
        "name":              "Bianchi Impianti",
        "ragione_sociale":   "Bianchi Impianti S.n.c.",
        "vat_number":        "IT09876543210",
        "password":          "Test1234!",
        "credits":           5,
        "subscription_active": False,
        "is_active":         True,
        "is_manager":        True,
    },
    {
        "email":             "verdi.energia@test.com",
        "name":              "Verdi Energia",
        "ragione_sociale":   "Verdi Energia S.p.A.",
        "vat_number":        "IT11223344556",
        "password":          "Test1234!",
        "credits":           10,
        "subscription_active": True,
        "is_active":         True,
        "is_manager":        True,
        "_plan":             "starter",
    },
    {
        "email":             "ferrara.fotovoltaico@test.com",
        "name":              "Ferrara Fotovoltaico",
        "ragione_sociale":   "Ferrara Fotovoltaico S.r.l.",
        "vat_number":        "IT55667788990",
        "password":          "Test1234!",
        "credits":           20,
        "subscription_active": True,
        "is_active":         True,
        "is_manager":        True,
        "_plan":             "medium",
    },
    {
        "email":             "marco.ferretti@test.com",
        "name":              "Marco Ferretti",
        "ragione_sociale":   "Ferretti Solar Group S.r.l.",
        "vat_number":        "IT33445566778",
        "password":          "Test1234!",
        "credits":           9999,
        "subscription_active": True,
        "is_active":         True,
        "is_manager":        True,
        "_plan":             "unlimited",
    },
    {
        "email":             "conti.solare@test.com",
        "name":              "Conti Solare",
        "ragione_sociale":   "Conti Solare S.r.l.",
        "vat_number":        "IT77889900112",
        "password":          "Test1234!",
        "credits":           3,
        "subscription_active": False,
        "is_active":         False,   # account disattivato
        "is_manager":        True,
    },
]

# ── Elaborazioni per Marco Ferretti ───────────────────────────────────────────
MARCO_JOBS = [
    {
        "tif_filename":   "impianto_bergamo_2024.tif",
        "panels_detected": 320,
        "hotspot_count":   7,
        "degraded_count":  12,
        "panel_model":    "Longi Solar LR5-72HBD",
        "panel_dimensions": "2278x1134",
        "panel_efficiency":  21.3,
        "panel_temp_coeff": -0.34,
        "days_ago":       2,
    },
    {
        "tif_filename":   "centrale_brescia_nord.tif",
        "panels_detected": 540,
        "hotspot_count":   3,
        "degraded_count":  21,
        "panel_model":    "JA Solar JAM72D30",
        "panel_dimensions": "2278x1134",
        "panel_efficiency":  20.8,
        "panel_temp_coeff": -0.35,
        "days_ago":       8,
    },
    {
        "tif_filename":   "parco_solare_cremona.tif",
        "panels_detected": 1200,
        "hotspot_count":  15,
        "degraded_count":  44,
        "panel_model":    "Jinko Tiger Pro 72HC",
        "panel_dimensions": "2274x1134",
        "panel_efficiency":  21.6,
        "panel_temp_coeff": -0.35,
        "days_ago":       15,
    },
    {
        "tif_filename":   "tetto_industriale_lodi.tif",
        "panels_detected":  88,
        "hotspot_count":   1,
        "degraded_count":   3,
        "panel_model":    "Canadian Solar CS6W-540TB",
        "panel_dimensions": "2256x1133",
        "panel_efficiency":  20.6,
        "panel_temp_coeff": -0.36,
        "days_ago":       23,
    },
    {
        "tif_filename":   "impianto_mantova_est.tif",
        "panels_detected":  760,
        "hotspot_count":   9,
        "degraded_count":  31,
        "panel_model":    "Risen Energy RSM144-7-590M",
        "panel_dimensions": "2278x1134",
        "panel_efficiency":  22.1,
        "panel_temp_coeff": -0.34,
        "days_ago":       40,
    },
    {
        "tif_filename":   "agrivoltaico_pavia.tif",
        "panels_detected": 2100,
        "hotspot_count":  28,
        "degraded_count":  67,
        "panel_model":    "Longi Solar LR5-72HTH",
        "panel_dimensions": "2256x1133",
        "panel_efficiency":  22.8,
        "panel_temp_coeff": -0.30,
        "days_ago":       60,
    },
    {
        "tif_filename":   "capannone_varese.tif",
        "panels_detected":  144,
        "hotspot_count":   0,
        "degraded_count":   5,
        "panel_model":    "Trina Solar TSM-DE19",
        "panel_dimensions": "2124x1052",
        "panel_efficiency":  21.0,
        "panel_temp_coeff": -0.34,
        "days_ago":       90,
    },
]


def main():
    db = SessionLocal()
    try:
        print("=" * 60)
        print("  SolarDino — Seed Database")
        print("=" * 60)

        # ── 1. Cancella tutte le aziende non-admin ──────────────────────
        from sqlalchemy import text

        # Ottieni gli ID delle aziende da cancellare (tutte tranne admin)
        admin = db.query(models.Company).filter(models.Company.email == ADMIN_EMAIL).first()
        if admin:
            print(f"  [SKIP]  Admin account mantenuto: {admin.email}")
            admin_id = admin.id
        else:
            admin_id = -1

        ids_to_delete = [
            row.id for row in
            db.query(models.Company.id).filter(models.Company.id != admin_id).all()
        ]

        if not ids_to_delete:
            print("  [INFO]  Nessuna azienda non-admin trovata.")
        else:
            # Cancella le tabelle dipendenti in ordine (FK senza cascade)
            tables_to_clear = [
                "ticket_messages",          # FK -> support_tickets
                "support_tickets",          # FK -> companies
                "notifications",            # FK -> companies
                "reviews",                  # FK -> companies
                "stripe_payments",          # FK -> companies
                "enterprise_inference_logs",# FK -> companies
                "flighthub_jobs",           # FK -> companies
                "flighthub_connections",    # FK -> companies
                "trial_requests",           # FK -> companies
                "pec_verification_tokens",  # FK -> companies
                "email_change_tokens",      # FK -> companies
            ]
            # Cancella le tabelle che hanno FK -> support_tickets
            for sub_tbl in ("ticket_messages", "ticket_replies", "notifications"):
                db.execute(text(
                    f"DELETE FROM {sub_tbl} WHERE ticket_id IN "
                    "(SELECT id FROM support_tickets WHERE company_id = ANY(:ids))"
                ), {"ids": ids_to_delete})
            # Cancella ticket_replies con FK diretta -> companies
            db.execute(text("DELETE FROM ticket_replies WHERE company_id = ANY(:ids)"), {"ids": ids_to_delete})
            # Cancella il resto con FK -> companies
            for tbl in tables_to_clear[1:]:  # support_tickets in poi
                db.execute(text(f"DELETE FROM {tbl} WHERE company_id = ANY(:ids)"), {"ids": ids_to_delete})

            # Cancella usage_logs e jobs tramite FK diretta
            db.execute(text(
                "DELETE FROM usage_logs WHERE job_id IN "
                "(SELECT id FROM jobs WHERE company_id = ANY(:ids))"
            ), {"ids": ids_to_delete})
            db.execute(text("DELETE FROM jobs WHERE company_id = ANY(:ids)"), {"ids": ids_to_delete})
            db.execute(text("DELETE FROM bonifico_requests WHERE company_id = ANY(:ids)"), {"ids": ids_to_delete})

            # Ora cancella le aziende
            db.execute(text("DELETE FROM companies WHERE id = ANY(:ids)"), {"ids": ids_to_delete})
            db.commit()
            print(f"\n  [OK]  Cancellate {len(ids_to_delete)} aziende non-admin.\n")

        # ── 2. Ricrea le aziende di test ────────────────────────────────
        _now = datetime.now(timezone.utc)
        created_companies: dict[str, models.Company] = {}
        for data in TEST_COMPANIES:
            plan = data.pop("_plan", None)
            password = data.pop("password")
            c = models.Company(
                password_hash=hash_password(password),
                **data,
            )
            if plan:
                sub_start = _now - timedelta(days=random.randint(1, 20))
                c.subscription_plan = plan
                c.subscription_start_date = sub_start
                c.subscription_end_date = (
                    sub_start + relativedelta(years=1)
                    if plan == "unlimited_annual"
                    else sub_start + relativedelta(months=1)
                )
            db.add(c)
            db.flush()  # ottieni l'ID
            created_companies[c.email] = c
            sub_label = f"abbonamento {plan}" if plan else ("inattivo" if not c.is_active else "nessun abbonamento")
            print(f"  [+]  {c.ragione_sociale or c.name}  ({c.email})  —  {c.credits} crediti  —  {sub_label}")

        db.commit()
        print()

        # ── 3. Crea elaborazioni per Marco Ferretti ─────────────────────
        marco = created_companies.get("marco.ferretti@test.com")
        if not marco:
            print("  [ERR]  Marco Ferretti non trovato, esco.")
            sys.exit(1)

        now = datetime.now(timezone.utc)
        for job_data in MARCO_JOBS:
            days_ago = job_data.pop("days_ago")
            created_at = now - timedelta(days=days_ago)
            completed_at = created_at + timedelta(minutes=8)
            job_id = str(uuid.uuid4())

            job = models.Job(
                id=job_id,
                company_id=marco.id,
                status="completato",
                result_path=f"elaborazioni/{job_id}/result.zip",
                log="Elaborazione completata con successo.",
                created_at=created_at,
                completed_at=completed_at,
                **job_data,
            )
            db.add(job)
            db.flush()

            usage = models.UsageLog(
                company_id=marco.id,
                job_id=job_id,
                panels_count=job.panels_detected,
                credits_used=1,
                created_at=completed_at,
            )
            db.add(usage)
            print(f"  [job]  {job.tif_filename}  —  {job.panels_detected} pannelli  —  {days_ago}gg fa")

        db.commit()
        print(f"\n  [OK]  {len(MARCO_JOBS)} elaborazioni create per Marco Ferretti.\n")

        print("=" * 60)
        print("  Seed completato con successo!")
        print("=" * 60)
        print()
        print("  Credenziali account di test (password: Test1234!):")
        for data in TEST_COMPANIES:
            email = data["email"]
            name = data.get("ragione_sociale") or data["name"]
            print(f"    {email:40s}  {name}")
        print()

    except Exception as e:
        db.rollback()
        print(f"\n  [ERR]  {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
