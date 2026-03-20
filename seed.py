"""
Seed script — popola il database con aziende demo e richieste bonus benvenuto.
Esecuzione: python seed.py
Idempotente: salta le aziende già presenti (controllo su email).
"""
import os
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv

load_dotenv()

from database import engine, SessionLocal, run_migrations
import models
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── Dati aziende demo ────────────────────────────────────────────────────────
COMPANIES = [
    {
        "email":           "info@solaretech.it",
        "name":            "Marco Bianchi",
        "ragione_sociale": "SolareTech S.r.l.",
        "vat_number":      "IT12345678901",
        "password":        "Demo1234!",
        "credits":         0,
        "is_manager":      True,
        "last_ip":         "82.56.120.10",
        "bonus_status":    "pending",
        "created_days_ago": 3,
    },
    {
        "email":           "admin@energiasole.it",
        "name":            "Laura Rossi",
        "ragione_sociale": "Energia Sole S.r.l.",
        "vat_number":      "IT98765432109",
        "password":        "Demo1234!",
        "credits":         1,
        "is_manager":      True,
        "last_ip":         "91.220.45.67",
        "bonus_status":    "approved",
        "created_days_ago": 10,
    },
    {
        "email":           "direzione@fotoverde.it",
        "name":            "Giovanni Esposito",
        "ragione_sociale": "FotoVerde S.p.A.",
        "vat_number":      "IT11223344556",
        "password":        "Demo1234!",
        "credits":         0,
        "is_manager":      True,
        "last_ip":         "82.56.120.10",   # stesso IP di SolareTech → warning
        "bonus_status":    "pending",
        "created_days_ago": 5,
    },
    {
        "email":           "contact@sunnypanel.it",
        "name":            "Sara Conti",
        "ragione_sociale": "Sunny Panel S.r.l.",
        "vat_number":      "IT55667788990",
        "password":        "Demo1234!",
        "credits":         0,
        "is_manager":      True,
        "last_ip":         "178.33.201.5",
        "bonus_status":    "pending",
        "created_days_ago": 1,
    },
    {
        "email":           "info@eliosystem.it",
        "name":            "Fabio Mancini",
        "ragione_sociale": "Elio System S.r.l.",
        "vat_number":      "IT44556677889",
        "password":        "Demo1234!",
        "credits":         0,
        "is_manager":      True,
        "last_ip":         "151.20.88.44",
        "bonus_status":    "rejected",
        "created_days_ago": 15,
    },
    {
        "email":           "hello@pannovaenergy.it",
        "name":            "Giulia Ferrara",
        "ragione_sociale": "Pannova Energy S.r.l.",
        "vat_number":      "IT33445566778",
        "password":        "Demo1234!",
        "credits":         0,
        "is_manager":      True,
        "last_ip":         "95.110.14.200",
        "bonus_status":    "pending",
        "created_days_ago": 2,
    },
    {
        "email":           "ops@greenroof.it",
        "name":            "Alessandro Ricci",
        "ragione_sociale": "Green Roof S.r.l.",
        "vat_number":      "IT22334455667",
        "password":        "Demo1234!",
        "credits":         1,
        "is_manager":      True,
        "last_ip":         "213.140.62.18",
        "bonus_status":    "approved",
        "created_days_ago": 20,
        "welcome_bonus_used": True,
    },
    {
        "email":           "info@voltasolar.it",
        "name":            "Chiara De Luca",
        "ragione_sociale": "Volta Solar S.r.l.",
        "vat_number":      "IT99887766554",
        "password":        "Demo1234!",
        "credits":         0,
        "is_manager":      True,
        "last_ip":         "88.41.50.100",
        "bonus_status":    "pending",
        "created_days_ago": 4,
    },
    {
        "email":           "ceo@radenergy.it",
        "name":            "Luca Moretti",
        "ragione_sociale": "Rad Energy S.r.l.",
        "vat_number":      "IT77665544332",
        "password":        "Demo1234!",
        "credits":         0,
        "is_manager":      True,
        "last_ip":         "178.33.201.5",   # stesso IP di SunnyPanel → warning
        "bonus_status":    "pending",
        "created_days_ago": 6,
    },
    {
        "email":           "info@solazurra.it",
        "name":            "Martina Gallo",
        "ragione_sociale": "Solazurra S.r.l.",
        "vat_number":      "IT66554433221",
        "password":        "Demo1234!",
        "credits":         0,
        "is_manager":      True,
        "last_ip":         "31.14.72.88",
        "bonus_status":    "pending",
        "created_days_ago": 7,
    },
    {
        "email":           "support@nextsun.it",
        "name":            "Roberto Lombardi",
        "ragione_sociale": "NextSun S.p.A.",
        "vat_number":      "IT55443322110",
        "password":        "Demo1234!",
        "credits":         0,
        "is_manager":      True,
        "last_ip":         "62.211.33.9",
        "bonus_status":    "pending",
        "created_days_ago": 0,
    },
    {
        "email":           "info@azimutpv.it",
        "name":            "Valentina Russo",
        "ragione_sociale": "Azimut PV S.r.l.",
        "vat_number":      "IT44332211009",
        "password":        "Demo1234!",
        "credits":         1,
        "is_manager":      True,
        "last_ip":         "193.200.5.15",
        "bonus_status":    "approved",
        "created_days_ago": 30,
        "welcome_bonus_used": True,
    },
]

def seed():
    run_migrations(engine)
    db = SessionLocal()
    added_companies = 0
    added_requests  = 0

    try:
        for data in COMPANIES:
            # Salta se esiste già
            existing = db.query(models.Company).filter(
                models.Company.email == data["email"]
            ).first()
            if existing:
                print(f"  [skip] {data['email']} già presente")
                continue

            days_ago = data.get("created_days_ago", 0)
            created_at = datetime.now(timezone.utc) - timedelta(days=days_ago)

            company = models.Company(
                email              = data["email"],
                name               = data["name"],
                ragione_sociale    = data["ragione_sociale"],
                vat_number         = data["vat_number"],
                password_hash      = pwd_context.hash(data["password"]),
                credits            = data.get("credits", 0),
                is_active          = True,
                is_manager         = data.get("is_manager", True),
                last_ip            = data.get("last_ip"),
                last_login_at      = created_at,
                welcome_bonus_used      = data.get("welcome_bonus_used", False),
                welcome_bonus_requested = True,
                created_at         = created_at,
            )
            db.add(company)
            db.flush()  # ottieni l'id

            # Crea la WelcomeBonusRequest
            bonus_status = data.get("bonus_status", "pending")
            req = models.WelcomeBonusRequest(
                company_id = company.id,
                status     = bonus_status,
                ip         = data.get("last_ip"),
                created_at = created_at + timedelta(minutes=5),
            )
            db.add(req)
            added_companies += 1
            added_requests  += 1
            print(f"  [+] {data['ragione_sociale']} — bonus: {bonus_status}")

        db.commit()
        print(f"\n✓ Seed completato: {added_companies} aziende, {added_requests} richieste bonus")
    except Exception as e:
        db.rollback()
        print(f"[ERRORE] {e}")
        raise
    finally:
        db.close()


MARCO_JOBS = [
    {
        "tif_filename":    "impianto_nord_A.tif",
        "panels_detected": 142,
        "hotspot_count":   8,
        "degraded_count":  3,
        "panel_model":     "JA Solar JAM60S20",
        "panel_dimensions": "1686x1002mm",
        "panel_efficiency": 20.2,
        "panel_temp_coeff": -0.35,
        "days_ago":        25,
        "minutes_to_complete": 7,
    },
    {
        "tif_filename":    "impianto_nord_B.tif",
        "panels_detected": 98,
        "hotspot_count":   2,
        "degraded_count":  1,
        "panel_model":     "JA Solar JAM60S20",
        "panel_dimensions": "1686x1002mm",
        "panel_efficiency": 20.2,
        "panel_temp_coeff": -0.35,
        "days_ago":        18,
        "minutes_to_complete": 5,
    },
    {
        "tif_filename":    "impianto_sud_estate.tif",
        "panels_detected": 310,
        "hotspot_count":   21,
        "degraded_count":  9,
        "panel_model":     "Longi LR4-72HPH",
        "panel_dimensions": "2094x1038mm",
        "panel_efficiency": 21.0,
        "panel_temp_coeff": -0.34,
        "days_ago":        12,
        "minutes_to_complete": 11,
    },
    {
        "tif_filename":    "capannone_industriale.tif",
        "panels_detected": 520,
        "hotspot_count":   35,
        "degraded_count":  14,
        "panel_model":     "Canadian Solar CS6W",
        "panel_dimensions": "2108x1048mm",
        "panel_efficiency": 20.8,
        "panel_temp_coeff": -0.34,
        "days_ago":        6,
        "minutes_to_complete": 18,
    },
    {
        "tif_filename":    "villa_residenziale.tif",
        "panels_detected": 24,
        "hotspot_count":   1,
        "degraded_count":  0,
        "panel_model":     "SunPower SPR-MAX3-400",
        "panel_dimensions": "1690x1046mm",
        "panel_efficiency": 22.6,
        "panel_temp_coeff": -0.29,
        "days_ago":        2,
        "minutes_to_complete": 3,
    },
]


def seed_jobs():
    db = SessionLocal()
    try:
        marco = db.query(models.Company).filter(
            models.Company.email == "info@solaretech.it"
        ).first()
        if not marco:
            print("[skip jobs] Azienda Marco Bianchi non trovata")
            return

        existing_jobs = db.query(models.Job).filter(
            models.Job.company_id == marco.id
        ).count()
        if existing_jobs > 0:
            print(f"  [skip jobs] {existing_jobs} job già presenti per Marco Bianchi")
            return

        now = datetime.now(timezone.utc)
        added = 0
        for j in MARCO_JOBS:
            job_id = str(__import__("uuid").uuid4())
            created_at   = now - timedelta(days=j["days_ago"])
            completed_at = created_at + timedelta(minutes=j["minutes_to_complete"])
            job = models.Job(
                id              = job_id,
                company_id      = marco.id,
                status          = "completato",
                tif_filename    = j["tif_filename"],
                result_path     = f"jobs/{job_id}",
                panels_detected = j["panels_detected"],
                hotspot_count   = j["hotspot_count"],
                degraded_count  = j["degraded_count"],
                panel_model     = j["panel_model"],
                panel_dimensions= j["panel_dimensions"],
                panel_efficiency= j["panel_efficiency"],
                panel_temp_coeff= j["panel_temp_coeff"],
                created_at      = created_at,
                completed_at    = completed_at,
            )
            db.add(job)
            added += 1
            print(f"  [+] Job: {j['tif_filename']} — {j['panels_detected']} pannelli")

        db.commit()
        print(f"\n✓ Job seed completato: {added} elaborazioni per Marco Bianchi (SolareTech)")
    except Exception as e:
        db.rollback()
        print(f"[ERRORE jobs] {e}")
        raise
    finally:
        db.close()


if __name__ == "__main__":
    print("Avvio seed database...\n")
    seed()
    print()
    print("Seed elaborazioni Marco Bianchi...\n")
    seed_jobs()
