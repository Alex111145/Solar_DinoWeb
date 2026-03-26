"""
Script one-shot: soft-delete companies

1. Tutte le aziende con nome 'Andrea GERVASINI SRL' (case-insensitive)
2. Tutte le aziende senza abbonamento attivo (subscription_active = False)
   — escluse quelle con email admin

Esegui con:  python cleanup_companies.py
"""
import os
from datetime import datetime, timezone
from database import SessionLocal
import models

TARGET_NAME = "andrea gervasini srl"
ADMIN_EMAILS = {"admin@solardino.it", "agervasini1@gmail.com"}

db = SessionLocal()
try:
    companies = db.query(models.Company).filter(models.Company.deleted_at.is_(None)).all()

    andrea_deleted = []
    no_sub_deleted = []

    for c in companies:
        if c.email in ADMIN_EMAILS:
            continue

        rs = (c.ragione_sociale or "").lower()
        nm = (c.name or "").lower()
        if TARGET_NAME in rs or TARGET_NAME in nm:
            c.deleted_at = datetime.now(timezone.utc)
            c.is_active = False
            andrea_deleted.append(f"  id={c.id}  name={c.name!r}  ragione_sociale={c.ragione_sociale!r}")
            continue

        if not c.subscription_active:
            c.deleted_at = datetime.now(timezone.utc)
            c.is_active = False
            no_sub_deleted.append(f"  id={c.id}  name={c.name!r}  email={c.email!r}")

    db.commit()

    print(f"\n=== Andrea GERVASINI SRL ({len(andrea_deleted)}) ===")
    for d in andrea_deleted: print(d)
    if not andrea_deleted: print("  (nessuna trovata)")

    print(f"\n=== Senza abbonamento ({len(no_sub_deleted)}) ===")
    for d in no_sub_deleted: print(d)
    if not no_sub_deleted: print("  (nessuna trovata)")

    print(f"\nTotale eliminate: {len(andrea_deleted) + len(no_sub_deleted)}")
finally:
    db.close()
