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


if __name__ == "__main__":
    print("Avvio seed database...\n")
    seed()
