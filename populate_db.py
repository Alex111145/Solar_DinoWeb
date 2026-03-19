"""
populate_db.py  —  Popola il DB con dati realistici e variegati.
Non cancella nulla: aggiunge solo aziende/job/ticket/review/pagamenti
che non esistono già.

Usage:  python3 populate_db.py
"""
import os, sys, uuid, random
from datetime import datetime, timedelta, timezone
from dateutil.relativedelta import relativedelta
from dotenv import load_dotenv
load_dotenv(override=True)

from database import SessionLocal
import models
from auth_utils import hash_password

now = datetime.now(timezone.utc)

def ago(**kw): return now - timedelta(**kw)
def rnd_date(days_min=1, days_max=90): return ago(days=random.randint(days_min, days_max))

# ── Nuove aziende da aggiungere ───────────────────────────────────────────────
NEW_COMPANIES = [
    # manager con unlimited + stripe customer simulato
    dict(email="borrelli.energy@test.com",      name="Borrelli Energy Srl",
         ragione_sociale="Borrelli Energy S.r.l.",   vat_number="IT88776655443",
         credits=9999, subscription_active=True,  is_active=True,  is_manager=True,
         _plan="unlimited"),
    # manager con medium
    dict(email="montanari.impianti@test.com",   name="Montanari Impianti SpA",
         ragione_sociale="Montanari Impianti S.p.A.", vat_number="IT22334455667",
         credits=18, subscription_active=True,  is_active=True,  is_manager=True,
         _plan="medium"),
    # manager con starter
    dict(email="giordano.solar@test.com",       name="Giordano Solar",
         ragione_sociale="Giordano Solar S.r.l.",    vat_number="IT44556677889",
         credits=7,  subscription_active=True,  is_active=True,  is_manager=True,
         _plan="starter"),
    # manager senza abbonamento con crediti
    dict(email="deluca.fotovoltaico@test.com",  name="De Luca Fotovoltaico",
         ragione_sociale="De Luca Fotovoltaico S.n.c.", vat_number="IT99887766554",
         credits=8,  subscription_active=False, is_active=True,  is_manager=True),
    # slave sotto Rossi Solar (stessa P.IVA: IT01234567890)
    dict(email="rossi.dipendente@test.com",     name="Luca Rossi",
         ragione_sociale=None,                       vat_number="IT01234567890",
         credits=0,  subscription_active=False, is_active=True,  is_manager=False),
    # manager con unlimited annuale
    dict(email="esposito.energia@test.com",     name="Esposito Energia Srl",
         ragione_sociale="Esposito Energia S.r.l.",  vat_number="IT66554433221",
         credits=9999, subscription_active=True,  is_active=True,  is_manager=True,
         _plan="unlimited_annual"),
    # account disattivato (soft-deleted)
    dict(email="romano.eng@test.com",           name="Romano Engineering",
         ragione_sociale="Romano Engineering S.r.l.", vat_number="IT11223300445",
         credits=2,  subscription_active=False, is_active=False, is_manager=True),
]

# ── Definizione job da creare per azienda ─────────────────────────────────────
# format: (tif_filename, status, panels, hotspot, degraded, days_ago)
JOBS_DEFS = {
    "borrelli.energy@test.com": [
        ("impianto_napoli_centro.tif",   "completato", 480,  5, 14, 3),
        ("parco_caserta.tif",            "completato", 1800, 22, 61, 12),
        ("tetto_salerno_a.tif",          "completato", 96,   0,  2, 28),
        ("inferenza_in_corso.tif",       "inferenza",  None, None, None, 1),
    ],
    "montanari.impianti@test.com": [
        ("piano_bologna.tif",            "completato", 350, 4, 10, 5),
        ("capannone_ferrara.tif",        "completato", 620, 8, 22, 20),
        ("upload_fallito.tif",           "errore",    None, None, None, 7),
    ],
    "giordano.solar@test.com": [
        ("impianto_torino_ovest.tif",    "completato", 140, 2, 5, 9),
        ("coda_attesa.tif",              "in_coda",   None, None, None, 0),
    ],
    "deluca.fotovoltaico@test.com": [
        ("parco_bari.tif",               "completato", 900, 11, 33, 15),
        ("tetto_taranto.tif",            "completato", 210,  1,  6, 45),
        ("errore_formato.tif",           "errore",    None, None, None, 3),
    ],
    "esposito.energia@test.com": [
        ("agrivoltaico_catania.tif",     "completato", 3200, 40, 110, 8),
        ("parco_palermo.tif",            "completato", 1560, 18,  55, 22),
        ("taglio_tiles.tif",             "taglio_tile", None, None, None, 1),
    ],
    "marco.ferretti@test.com": [   # già ha 7 job, ne aggiungiamo ancora
        ("nuovo_impianto_milano.tif",    "completato", 430, 6, 15, 5),
        ("tetto_monza.tif",              "completato", 88,  0,  2, 18),
    ],
    "verdi.energia@test.com": [
        ("impianto_verona.tif",          "completato", 260, 3, 8, 11),
    ],
    "ferrara.fotovoltaico@test.com": [
        ("piano_modena.tif",             "completato", 700, 9, 27, 7),
        ("copertura_reggio.tif",         "completato", 420, 5, 13, 35),
    ],
}

# ── Ticket di supporto ────────────────────────────────────────────────────────
TICKETS_DEFS = [
    dict(email="borrelli.energy@test.com",     subject="Problema download KML",
         message="Il file KML non si apre su Google Earth, è corrotto.", status="risolto",
         admin_reply="Abbiamo verificato: il file era corretto ma Google Earth richiedeva un aggiornamento. Ha risolto?",
         days_ago=14),
    dict(email="montanari.impianti@test.com",  subject="Elaborazione bloccata",
         message="Ho caricato un TIF da 800 MB e il job è rimasto in coda per 2 ore.", status="in_elaborazione",
         admin_reply="Stiamo analizzando il job #montanari001. I file >500 MB richiedono tempi più lunghi.",
         days_ago=3),
    dict(email="giordano.solar@test.com",      subject="Crediti non scalati correttamente",
         message="Ho eseguito un'elaborazione ma i crediti non sono stati scalati.", status="aperto",
         days_ago=1),
    dict(email="deluca.fotovoltaico@test.com", subject="Report CSV mancante",
         message="Nel risultato finale manca il file CSV dei pannelli geolocalizzati.", status="risolto",
         admin_reply="Il CSV era presente nell'archivio ZIP nella sottocartella /data. Il problema era la struttura dello ZIP.",
         days_ago=20),
    dict(email="verdi.energia@test.com",       subject="Come collegare FlightHub 2?",
         message="Non riesco a trovare il Workspace ID sulla piattaforma DJI.", status="risolto",
         admin_reply="Il Workspace ID si trova in FlightHub 2 → Impostazioni → Informazioni workspace. È un UUID di 36 caratteri.",
         days_ago=30),
    dict(email="marco.ferretti@test.com",      subject="Accesso dipendente non funziona",
         message="Ho creato un account dipendente ma non riesce ad accedere.", status="aperto",
         days_ago=2),
    dict(email="ferrara.fotovoltaico@test.com",subject="Hotspot falsi positivi",
         message="Il modello sembra rilevare hotspot su pannelli perfettamente funzionanti.", status="in_elaborazione",
         admin_reply="Stiamo analizzando l'immagine da te caricata. In alcuni casi alta riflessione solare causa falsi positivi.",
         days_ago=5),
    dict(email="borrelli.energy@test.com",     subject="Fattura abbonamento",
         message="Avrei bisogno della fattura per il mese di marzo per il nostro ufficio amministrativo.", status="aperto",
         days_ago=1),
]

# ── Recensioni ────────────────────────────────────────────────────────────────
REVIEWS_DEFS = [
    dict(email="marco.ferretti@test.com",       stars=5, status="approved",
         comment="Strumento eccellente. In pochi minuti otteniamo report che prima richiedevano ore di analisi manuale. Il KML geolocalizzato è fondamentale per le nostre ispezioni."),
    dict(email="borrelli.energy@test.com",       stars=5, status="approved",
         comment="Abbiamo ridotto i tempi di ispezione del 70%. Il rilevamento degli hotspot è preciso e il supporto tecnico risponde velocemente."),
    dict(email="verdi.energia@test.com",         stars=4, status="approved",
         comment="Ottima piattaforma. Avrei preferito poter caricare più file contemporaneamente, ma per il resto è perfetta."),
    dict(email="montanari.impianti@test.com",    stars=4, status="pending",
         comment="Buon servizio, l'analisi è rapida. A volte l'upload di file grandi è lento."),
    dict(email="giordano.solar@test.com",        stars=3, status="pending",
         comment="Funziona bene per impianti piccoli. Speriamo migliorino la gestione dei file TIF molto grandi."),
    dict(email="deluca.fotovoltaico@test.com",   stars=5, status="approved",
         comment="Il report geolocalizzato è esattamente quello che cercavamo. I clienti finali sono impressionati."),
    dict(email="ferrara.fotovoltaico@test.com",  stars=4, status="approved",
         comment="Piattaforma solida. L'integrazione con FlightHub 2 è una killer feature per chi usa droni DJI."),
    dict(email="esposito.energia@test.com",      stars=5, status="pending",
         comment="Usiamo SolarDino per tutti i nostri parchi fotovoltaici. Incredibile risparmio di tempo."),
]

# ── Pagamenti Stripe ──────────────────────────────────────────────────────────
STRIPE_PAYMENTS = [
    dict(email="borrelli.energy@test.com",      package="unlimited",        credits=9999, amount_eur=299.99, days_ago=5),
    dict(email="borrelli.energy@test.com",      package="unlimited",        credits=9999, amount_eur=299.99, days_ago=35),
    dict(email="montanari.impianti@test.com",   package="medium",           credits=20,   amount_eur=169.99, days_ago=8),
    dict(email="giordano.solar@test.com",       package="starter",          credits=10,   amount_eur=99.99,  days_ago=12),
    dict(email="verdi.energia@test.com",        package="starter",          credits=10,   amount_eur=99.99,  days_ago=15),
    dict(email="verdi.energia@test.com",        package="starter",          credits=10,   amount_eur=99.99,  days_ago=45),
    dict(email="ferrara.fotovoltaico@test.com", package="medium",           credits=20,   amount_eur=169.99, days_ago=10),
    dict(email="ferrara.fotovoltaico@test.com", package="medium",           credits=20,   amount_eur=169.99, days_ago=40),
    dict(email="marco.ferretti@test.com",       package="unlimited",        credits=9999, amount_eur=299.99, days_ago=7),
    dict(email="marco.ferretti@test.com",       package="unlimited",        credits=9999, amount_eur=299.99, days_ago=37),
    dict(email="esposito.energia@test.com",     package="unlimited_annual", credits=9999, amount_eur=2400.00, days_ago=20),
    dict(email="alessiogervasini042@gmail.com", package="medium",           credits=20,   amount_eur=169.99, days_ago=3),
]

# ── Bonifici ──────────────────────────────────────────────────────────────────
BONIFICO_DEFS = [
    dict(email="deluca.fotovoltaico@test.com",  package="medium",   credits=20, amount_eur=169.99, status="approved", days_ago=30),
    dict(email="deluca.fotovoltaico@test.com",  package="starter",  credits=10, amount_eur=99.99,  status="approved", days_ago=60),
    dict(email="rossi.solar@test.com",          package="starter",  credits=10, amount_eur=99.99,  status="pending",  days_ago=1),
    dict(email="bianchi.impianti@test.com",     package="medium",   credits=20, amount_eur=169.99, status="rejected", days_ago=10),
    dict(email="giordano.solar@test.com",       package="medium",   credits=20, amount_eur=169.99, status="pending",  days_ago=2),
]


def get_or_create_company(db, email):
    return db.query(models.Company).filter(models.Company.email == email).first()


def main():
    db = SessionLocal()
    try:
        print("=" * 60)
        print("  SolarDino — Populate Database")
        print("=" * 60)

        # ── 1. Aggiungi nuove aziende ──────────────────────────────
        print("\n[+] Aziende")
        email_to_id: dict[str, int] = {}
        for data in NEW_COMPANIES:
            plan = data.pop("_plan", None)
            existing = get_or_create_company(db, data["email"])
            if existing:
                print(f"  [skip] {data['email']} già presente")
                email_to_id[data["email"]] = existing.id
                continue
            c = models.Company(password_hash=hash_password("Test1234!"), **data)
            if plan:
                sub_start = now - timedelta(days=random.randint(1, 20))
                c.subscription_plan = plan
                c.subscription_start_date = sub_start
                c.subscription_end_date = (
                    sub_start + relativedelta(years=1)
                    if plan == "unlimited_annual"
                    else sub_start + relativedelta(months=1)
                )
            db.add(c)
            db.flush()
            email_to_id[c.email] = c.id
            print(f"  [+] {c.ragione_sociale or c.name} ({c.email})")
        db.commit()

        # Mappa email → id per tutte le aziende esistenti
        for c in db.query(models.Company).all():
            email_to_id[c.email] = c.id

        # ── 2. Job ─────────────────────────────────────────────────
        print("\n[+] Jobs")
        job_count = 0
        for email, jobs in JOBS_DEFS.items():
            cid = email_to_id.get(email)
            if not cid:
                print(f"  [skip] azienda non trovata: {email}")
                continue
            for (filename, status, panels, hotspot, degraded, days_ago) in jobs:
                created_at = ago(days=days_ago, hours=random.randint(0, 6))
                completed_at = created_at + timedelta(minutes=random.randint(5, 15)) if status == "completato" else None
                job_id = str(uuid.uuid4())
                job = models.Job(
                    id=job_id,
                    company_id=cid,
                    status=status,
                    tif_filename=filename,
                    result_path=f"elaborazioni/{job_id}/result.zip" if status == "completato" else None,
                    panels_detected=panels,
                    hotspot_count=hotspot or 0,
                    degraded_count=degraded or 0,
                    log="Elaborazione completata." if status == "completato" else ("Errore durante l'inferenza." if status == "errore" else None),
                    panel_model=random.choice(["Longi Solar LR5-72HBD", "JA Solar JAM72D30", "Jinko Tiger Pro", "Canadian Solar CS6W", None]),
                    panel_efficiency=round(random.uniform(20.0, 23.0), 1) if random.random() > 0.3 else None,
                    created_at=created_at,
                    completed_at=completed_at,
                )
                db.add(job)
                db.flush()
                if status == "completato" and panels:
                    db.add(models.UsageLog(company_id=cid, job_id=job_id, panels_count=panels, credits_used=1, created_at=completed_at))
                job_count += 1
        db.commit()
        print(f"  [ok] {job_count} job aggiunti")

        # ── 3. Ticket di supporto ──────────────────────────────────
        print("\n[+] Ticket")
        tk_count = 0
        for td in TICKETS_DEFS:
            cid = email_to_id.get(td["email"])
            if not cid: continue
            created_at = ago(days=td["days_ago"])
            ticket = models.SupportTicket(
                company_id=cid,
                subject=td["subject"],
                message=td["message"],
                status=td["status"],
                created_at=created_at,
            )
            db.add(ticket)
            db.flush()
            # Messaggio iniziale del cliente
            db.add(models.TicketMessage(ticket_id=ticket.id, sender="client", text=td["message"], created_at=created_at))
            # Risposta admin se presente
            if "admin_reply" in td:
                reply_at = created_at + timedelta(hours=random.randint(2, 8))
                db.add(models.TicketMessage(ticket_id=ticket.id, sender="admin", text=td["admin_reply"], created_at=reply_at))
                ticket.reply = td["admin_reply"]
                ticket.replied_at = reply_at
                # Notifica al cliente
                db.add(models.Notification(
                    company_id=cid,
                    title=f"Risposta alla tua segnalazione #{ticket.id}",
                    message=td["admin_reply"][:120],
                    ticket_id=ticket.id,
                    created_at=reply_at,
                ))
            tk_count += 1
        db.commit()
        print(f"  [ok] {tk_count} ticket aggiunti")

        # ── 4. Recensioni ─────────────────────────────────────────
        print("\n[+] Recensioni")
        rv_count = 0
        for rd in REVIEWS_DEFS:
            cid = email_to_id.get(rd["email"])
            if not cid: continue
            existing = db.query(models.Review).filter(models.Review.company_id == cid).first()
            if existing:
                print(f"  [skip] recensione già presente per {rd['email']}")
                continue
            db.add(models.Review(
                company_id=cid,
                stars=rd["stars"],
                comment=rd.get("comment"),
                status=rd["status"],
                created_at=rnd_date(10, 60),
            ))
            rv_count += 1
        db.commit()
        print(f"  [ok] {rv_count} recensioni aggiunte")

        # ── 5. Pagamenti Stripe ───────────────────────────────────
        print("\n[+] Pagamenti Stripe")
        sp_count = 0
        for pd in STRIPE_PAYMENTS:
            cid = email_to_id.get(pd["email"])
            if not cid: continue
            session_id = f"cs_test_{uuid.uuid4().hex[:24]}"
            existing = db.query(models.StripePayment).filter(models.StripePayment.stripe_session == session_id).first()
            if existing: continue
            db.add(models.StripePayment(
                company_id=cid,
                stripe_session=session_id,
                package=pd["package"],
                credits=pd["credits"],
                amount_eur=pd["amount_eur"],
                created_at=ago(days=pd["days_ago"]),
            ))
            sp_count += 1
        db.commit()
        print(f"  [ok] {sp_count} pagamenti Stripe aggiunti")

        # ── 6. Richieste bonifico ─────────────────────────────────
        print("\n[+] Richieste bonifico")
        bn_count = 0
        for bd in BONIFICO_DEFS:
            cid = email_to_id.get(bd["email"])
            if not cid: continue
            created_at = ago(days=bd["days_ago"])
            approved_at = created_at + timedelta(days=1) if bd["status"] == "approved" else None
            db.add(models.BonificoRequest(
                company_id=cid,
                package=bd["package"],
                credits=bd["credits"],
                amount_eur=bd["amount_eur"],
                status=bd["status"],
                created_at=created_at,
                approved_at=approved_at,
            ))
            bn_count += 1
        db.commit()
        print(f"  [ok] {bn_count} richieste bonifico aggiunte")

        # ── Summary ───────────────────────────────────────────────
        tot_companies = db.query(models.Company).count()
        tot_jobs      = db.query(models.Job).count()
        tot_tickets   = db.query(models.SupportTicket).count()
        tot_reviews   = db.query(models.Review).count()
        tot_payments  = db.query(models.StripePayment).count()
        tot_bonifici  = db.query(models.BonificoRequest).count()

        print("\n" + "=" * 60)
        print("  Popolamento completato!")
        print("=" * 60)
        print(f"  Aziende totali:     {tot_companies}")
        print(f"  Job totali:         {tot_jobs}")
        print(f"  Ticket totali:      {tot_tickets}")
        print(f"  Recensioni totali:  {tot_reviews}")
        print(f"  Pagamenti Stripe:   {tot_payments}")
        print(f"  Bonifici:           {tot_bonifici}")
        print()

    except Exception as e:
        db.rollback()
        import traceback; traceback.print_exc()
        sys.exit(1)
    finally:
        db.close()


if __name__ == "__main__":
    main()
