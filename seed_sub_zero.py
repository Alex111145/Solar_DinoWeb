"""
Crea (o aggiorna) un account di test con abbonamento Starter attivo e 0 crediti.
Utile per testare la sezione "acquisto elaborazioni extra".

Usage:  python seed_sub_zero.py
"""
import os
import sys
from datetime import datetime, timezone
from dateutil.relativedelta import relativedelta

from dotenv import load_dotenv
load_dotenv(override=True)

import psycopg2
import bcrypt

RAW_URL = os.getenv("DATABASE_URL", "")
if not RAW_URL:
    print("[ERR] DATABASE_URL non trovato nel .env")
    sys.exit(1)

# Strip SQLAlchemy driver prefix
conn_str = RAW_URL.replace("postgresql+psycopg2://", "postgresql://").replace("postgresql+asyncpg://", "postgresql://")

EMAIL    = "abbonato.zero@test.com"
PASSWORD = "Test1234!"
NAME     = "Test Abbonato Esaurito"
RAG_SOC  = "Test Abbonato S.r.l."
VAT      = "IT99988877766"
PLAN     = "starter"

now = datetime.now(timezone.utc)
sub_end = now + relativedelta(months=1)

pw_hash = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt()).decode()

conn = psycopg2.connect(conn_str)
cur  = conn.cursor()

cur.execute("SELECT id FROM companies WHERE email = %s", (EMAIL,))
row = cur.fetchone()

if row:
    cur.execute("""
        UPDATE companies SET
            password_hash         = %s,
            name                  = %s,
            ragione_sociale       = %s,
            vat_number            = %s,
            credits               = 0,
            subscription_active   = TRUE,
            subscription_plan     = %s,
            subscription_start_date = %s,
            subscription_end_date   = %s,
            subscription_cancelled  = FALSE,
            is_active             = TRUE,
            is_manager            = TRUE,
            deleted_at            = NULL
        WHERE email = %s
    """, (pw_hash, NAME, RAG_SOC, VAT, PLAN, now, sub_end, EMAIL))
    print(f"[UPDATE] Account aggiornato: {EMAIL}")
else:
    cur.execute("""
        INSERT INTO companies
            (email, password_hash, name, ragione_sociale, vat_number,
             credits, subscription_active, subscription_plan,
             subscription_start_date, subscription_end_date,
             is_active, is_manager)
        VALUES (%s,%s,%s,%s,%s, 0,TRUE,%s, %s,%s, TRUE,TRUE)
    """, (EMAIL, pw_hash, NAME, RAG_SOC, VAT, PLAN, now, sub_end))
    print(f"[INSERT] Account creato: {EMAIL}")

conn.commit()
cur.close()
conn.close()

print()
print("  Email   :", EMAIL)
print("  Password:", PASSWORD)
print("  Piano   : Starter (abbonamento attivo)")
print("  Crediti : 0  ← vedrà la sezione acquisto elaborazioni extra")
print("  Scadenza:", sub_end.strftime("%d/%m/%Y"))
