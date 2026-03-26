"""
Migration: rimuove welcome_bonus_requests e welcome_bonus_requested dal DB.
Il flusso manuale è stato eliminato — il bonus è ora solo automatico alla registrazione.

Esegui con:  python migrate_remove_bonus_table.py
"""
import os
import psycopg2

DATABASE_URL = os.getenv("DATABASE_URL", "")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL non impostata")

conn = psycopg2.connect(DATABASE_URL)
conn.autocommit = True
cur = conn.cursor()

# 1. Drop tabella welcome_bonus_requests
cur.execute("""
    DROP TABLE IF EXISTS welcome_bonus_requests CASCADE;
""")
print("✓ Tabella welcome_bonus_requests eliminata")

# 2. Rimuovi colonna welcome_bonus_requested da companies
cur.execute("""
    ALTER TABLE companies
    DROP COLUMN IF EXISTS welcome_bonus_requested;
""")
print("✓ Colonna welcome_bonus_requested rimossa da companies")

cur.close()
conn.close()
print("\nMigration completata.")
