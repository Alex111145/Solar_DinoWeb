"""
Script one-shot: soft-delete tutte le aziende con ragione_sociale o name
che contiene 'Andrea GERVASINI SRL' (case-insensitive).

Esegui con:  python delete_andrea_gervasini.py
"""
import os
from datetime import datetime, timezone

from database import SessionLocal
import models

TARGET = "andrea gervasini srl"

db = SessionLocal()
try:
    companies = (
        db.query(models.Company)
        .filter(models.Company.deleted_at.is_(None))
        .all()
    )

    deleted = []
    for c in companies:
        rs = (c.ragione_sociale or "").lower()
        nm = (c.name or "").lower()
        if TARGET in rs or TARGET in nm:
            c.deleted_at = datetime.now(timezone.utc)
            c.is_active = False
            deleted.append(f"  id={c.id}  name={c.name!r}  ragione_sociale={c.ragione_sociale!r}")

    if not deleted:
        print("Nessuna azienda trovata con quel nome.")
    else:
        db.commit()
        print(f"Eliminate (soft-delete) {len(deleted)} aziende:")
        for d in deleted:
            print(d)
finally:
    db.close()
