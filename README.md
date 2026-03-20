# SolarDino — Backend & API Documentation

Piattaforma AI per il rilevamento e l'analisi di pannelli solari tramite immagini termiche da drone.

---

## Come avviare il progetto

### Avvio rapido (sviluppo locale)

```bash
# Backend
uvicorn main:app --reload --port 8000

# Frontend (in un secondo terminale)
cd frontend && npm run dev
```

### Prerequisiti

- Python 3.10+
- Node.js 18+
- PostgreSQL (o account Supabase)
- Account Stripe
- Account Supabase (per lo storage file)

### 1. Clona il repository

```bash
git clone https://github.com/tuo-utente/solardino_web.git
cd solardino_web
```

### 2. Configura le variabili d'ambiente

Crea un file `.env` nella root del progetto:

```env
DATABASE_URL=postgresql://user:password@host:5432/dbname
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key
SUPABASE_BUCKET=pth

STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...

ML_SERVER_URL=http://your-oracle-server:8001
ML_SERVER_SECRET=your_ml_secret

ADMIN_EMAIL=admin@solardino.it
ADMIN_PASSWORD=changeme123

MODEL_PTH_URL=https://url-to-your-model/model_best.pth
```

### 3. Installa le dipendenze Python

```bash
pip install -r requirements.txt
```

### 4. Avvia il backend

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Il server si avvia, crea automaticamente le tabelle nel DB, applica le migrazioni e crea l'utente admin se non esiste.

API docs disponibili su: `http://localhost:8000/docs`

### 5. Installa le dipendenze frontend

```bash
cd frontend
npm install
```

### 6. Avvia il frontend in sviluppo

```bash
npm run dev
```

Il frontend gira su `http://localhost:5173` e punta all'API su `http://localhost:8000`.

### 7. Build frontend per produzione

```bash
cd frontend
npm run build
```

I file buildati finiscono in `static/app/` e vengono serviti direttamente da FastAPI.

### 8. (Opzionale) Popola il DB con dati demo

```bash
python seed.py
```

Crea 12 aziende demo con richieste bonus benvenuto ed elaborazioni di esempio.

---

## Architettura generale

```
[React Frontend] ←──── HTTPS ────→ [FastAPI Backend su Render]
                                           │
                    ┌──────────────────────┼──────────────────┐
                    ▼                      ▼                  ▼
             [PostgreSQL            [Supabase Storage]   [ML Server su
              su Supabase]           (file TIF/output)    Oracle Cloud]
                    │
              [Stripe API]
              [DJI FlightHub API]
              [VIES EU API]
```

---

## Stack tecnologico

| Layer | Tecnologia |
|---|---|
| Backend | FastAPI (Python) |
| Frontend | React 18 + TypeScript + Vite |
| Database | PostgreSQL su Supabase |
| Storage file | Supabase Storage |
| Hosting backend | Render |
| Pagamenti | Stripe |
| ML / AI | MaskDINO su Oracle Cloud (GPU) |
| Drone integration | DJI FlightHub 2 Enterprise |

---

## 1. Server — `main.py`

Il server è **FastAPI**, gira su **Render** (cloud hosting).

Al **primo avvio** (`lifespan`) fa queste cose in sequenza:
1. Crea tutte le tabelle del DB se non esistono (`Base.metadata.create_all`)
2. Applica le migrazioni incrementali (ALTER TABLE per aggiungere colonne nuove) — idempotenti, non crashano se la colonna esiste già
3. Crea l'utente **admin** se non esiste (email/password da variabili d'ambiente)
4. Scarica il file `model_best.pth` (modello AI) da URL configurato, se non è già presente su disco

Il frontend React buildato è servito come **SPA** — ogni route (`/`, `/login`, `/dashboard`, `/admin`) ritorna lo stesso `index.html` e React gestisce il routing lato client.

---

## 2. Database — `database.py` + `models.py`

**PostgreSQL su Supabase** — accesso via `DATABASE_URL`.

Pool di connessioni: `pool_size=10`, `max_overflow=20`.

### Tabelle principali

| Tabella | Descrizione |
|---|---|
| `companies` | Aziende/utenti. Contiene tutto: crediti, abbonamento Stripe, IP, P.IVA, flag manager/slave |
| `jobs` | Ogni elaborazione lanciata. Status: `in_coda → taglio_tile → inferenza → completato/errore` |
| `stripe_payments` | Pagamenti Stripe confermati dal webhook |
| `support_tickets` + `ticket_messages` | Sistema segnalazioni conversazionale |
| `notifications` | Notifiche client (es. risposta admin al ticket) |
| `welcome_bonus_requests` | Richieste bonus benvenuto con tracciamento IP antifrode |
| `bonifico_requests` | Richieste pagamento tramite bonifico bancario |
| `reviews` | Recensioni delle aziende (moderate dall'admin) |
| `flighthub_connections` | Credenziali OAuth DJI FlightHub 2 per azienda |
| `flighthub_jobs` | Job avviati da DJI invece che da upload manuale |
| `usage_logs` | Log ogni elaborazione (pannelli trovati, crediti usati) |
| `pec_verification_tokens` | Token verifica PEC alla registrazione |
| `email_change_tokens` | Token conferma cambio email |
| `enterprise_inference_logs` | Log consenso dati per clienti Enterprise |

---

## 3. Autenticazione — `routers/auth.py`

**Cookie HttpOnly** — niente token in localStorage, più sicuro contro XSS.

| Endpoint | Descrizione |
|---|---|
| `POST /auth/register` | Registrazione con validazione P.IVA (checksum italiano + VIES EU), verifica dominio email aziendale, invio email verifica PEC |
| `POST /auth/register-fast` | Registrazione rapida senza verifica PEC |
| `POST /auth/login` | Login → imposta cookie di sessione |
| `POST /auth/logout` | Cancella il cookie |
| `GET /auth/me` | Dati profilo utente corrente |
| `POST /auth/change-email` | Cambio email con conferma via link |
| `POST /auth/change-password` | Cambio password |
| `DELETE /auth/me` | Elimina account (soft delete) |
| `GET /auth/slaves` | Lista account dipendenti dell'azienda |
| `POST /auth/create-slave` | Crea account dipendente (stessi crediti via P.IVA) |
| `DELETE /auth/slaves/{id}` | Rimuove dipendente |
| `POST /auth/support` | Apre nuovo ticket |
| `GET /auth/tickets` | Lista ticket dell'utente |
| `GET /auth/tickets/{id}` | Dettaglio ticket con messaggi |
| `POST /auth/tickets/{id}/message` | Invia messaggio nel ticket |
| `POST /auth/tickets/{id}/close` | Client chiude il ticket (status → `risolto`) |
| `GET /auth/notifications` | Notifiche non lette |
| `POST /auth/notifications/{id}/read` | Segna notifica come letta |
| `GET /auth/check-vat/{vat}` | Verifica P.IVA in tempo reale |
| `POST /auth/request-welcome-bonus` | Richiede il bonus di benvenuto (1 credito gratis) |

**Sistema multi-account (manager/slave):** quando un manager crea un dipendente, i crediti sono condivisi per P.IVA — `sync_credits_by_vat()` aggiorna tutti gli account con la stessa P.IVA.

---

## 4. Elaborazioni — `routers/missions.py`

| Endpoint | Descrizione |
|---|---|
| `POST /missions/upload` | Carica TIF termico + opzionali (TFW, RGB). Scala 1 credito, crea Job in DB, avvia upload su Supabase + chiamata al ML server in background |
| `GET /missions` | Lista job dell'utente (ultimi 100) |
| `GET /missions/history` | Alias del precedente (usato dallo storico client) |
| `GET /missions/{id}/status` | Stato + progresso percentuale del job |
| `GET /missions/{id}/download/{format}` | Scarica file output (`json`, `csv`, `geojson`, `kml`, `kmz`) via URL firmato Supabase |
| `GET /missions/{id}/download-input` | Scarica il TIF originale caricato |
| `GET /missions/{id}/input-files` | Lista tutti i file di input con URL firmati (TIF, TFW, RGB) |
| `GET /missions/trial-status` | Controlla se l'azienda ha già richiesto la prova |
| `POST /missions/request-trial` | Invia richiesta prova gratuita → email all'admin |

### Flusso elaborazione

```
Client carica TIF
      ↓
Backend salva file in temp locale
      ↓
Background task: upload su Supabase Storage (jobs/{job_id}/)
      ↓
Chiama ML Server: POST http://oracle-server:8001/run
      ↓
ML Server processa → aggiorna status nel DB → carica risultati su Supabase
```

### Struttura file su Supabase Storage

```
jobs/
  {job_uuid}/
    termico_filename.tif         ← input (sempre presente)
    termico_filename.tfw         ← input (opzionale)
    rgb_filename.tif             ← input (opzionale)
    rgb_filename.tfw             ← input (opzionale)
    Rilevamenti_Pannelli.json    ← output
    Rilevamenti_Pannelli.csv     ← output
    Rilevamenti_Pannelli.geojson ← output
    Mappa_Pannelli.kml           ← output
    Mappa_Pannelli.kmz           ← output
```

---

## 5. Pagamenti — `routers/payments.py`

Integrazione **Stripe**.

| Endpoint | Descrizione |
|---|---|
| `POST /payments/subscribe` | Crea Stripe Checkout Session per un piano (`starter`, `medium`, `unlimited`, `unlimited_annual`) → ritorna URL redirect a Stripe |
| `POST /payments/portal` | Crea URL al portale Stripe per gestione carta |
| `POST /payments/cancel-subscription` | Cancella il rinnovo automatico (abbonamento resta attivo fino a scadenza) |
| `POST /payments/webhook` | **Webhook Stripe** — gestisce `checkout.session.completed` (attiva abbonamento + crediti) e `customer.subscription.deleted` (disattiva abbonamento) |

---

## 6. Admin — `routers/admin.py`

Tutte le route richiedono che l'utente loggato sia l'admin (`ADMIN_EMAIL`).

| Gruppo | Endpoint principali |
|---|---|
| **Stats** | `GET /admin/stats` — fatturato, utenti, job, abbonamenti ultimi 30 gg |
| **Aziende** | CRUD completo: lista, crea, modifica, attiva/disattiva, aggiungi credito, elimina |
| **Azienda singola** | Jobs, statistiche uso, storico elaborazioni per mese |
| **Fatturazione** | `GET /admin/billing` — tutti i pagamenti Stripe raggruppati per azienda |
| **Bonifici** | Lista richieste, approva/rifiuta (aggiunge crediti manualmente) |
| **Recensioni** | Lista, approva, rifiuta, elimina |
| **Ticket** | Lista tutti i ticket, dettaglio, cambia stato, rispondi (crea messaggio + notifica al client) |
| **Upload files** | Lista file Supabase per ogni job, download file singoli |
| **Bonus benvenuto** | Lista richieste, approva (aggiunge 1 credito), rifiuta — con rilevamento IP duplicato antifrode |
| **Enterprise logs** | Log consenso dati, esportazione CSV |

---

## 7. DJI FlightHub 2 — `routers/flighthub.py`

Integrazione con la piattaforma drone DJI per clienti Enterprise.

| Endpoint | Descrizione |
|---|---|
| `GET /flighthub/status` | Stato connessione + lista missioni sincronizzate |
| `POST /flighthub/connect` | Salva credenziali DJI (workspace_id, client_id, client_secret) |
| `DELETE /flighthub/disconnect` | Rimuove connessione |
| `POST /flighthub/sync` | Sincronizza le missioni/mappe dal workspace DJI |
| `POST /flighthub/webhook` | Webhook DJI — riceve notifica quando una mappa è pronta → avvia elaborazione automatica |
| `GET /flighthub/missions/{id}/download/{format}` | Scarica risultati di un job FH |
| `POST /flighthub/avvia-inferenza` | Avvia manualmente l'elaborazione di una mappa FH |

**Flusso DJI:** DJI chiama il webhook → backend scarica il TIF ortomosaico dall'API DJI → crea Job interno → avvia lo stesso ML server degli upload manuali → carica risultati su Supabase → (opzionale) carica il KML su FlightHub.

---

## 8. Storage — `storage_utils.py`

Tutti i file vanno su **Supabase Storage**.

- `upload_file(local_path, storage_path)` — carica un file
- `get_signed_url(storage_path, expires_in=300)` — URL firmato temporaneo (mai URL permanenti)
- `list_files(folder_path)` — lista file in una cartella

---

## 9. ML Server — Oracle Cloud

Server separato con GPU, non su Render.

Il backend lo chiama con:
```
POST http://{ML_SERVER_URL}/run
Headers: x-secret: {ML_SERVER_SECRET}
Body: { job_id, tif_storage_path, tfw_storage_path }
```

Il ML server:
1. Scarica i file da Supabase
2. Esegue la segmentazione con **MaskDINO** (modello AI per rilevare pannelli solari)
3. Genera i file di output (JSON, CSV, GeoJSON, KML, KMZ)
4. Carica i risultati su Supabase
5. Aggiorna lo status del job nel DB

---

## 10. Variabili d'ambiente

| Variabile | Descrizione |
|---|---|
| `DATABASE_URL` | Stringa connessione PostgreSQL (Supabase) |
| `SUPABASE_URL` | URL progetto Supabase |
| `SUPABASE_SERVICE_KEY` | Chiave service role Supabase |
| `SUPABASE_BUCKET` | Nome bucket storage (default: `pth`) |
| `STRIPE_SECRET_KEY` | Chiave segreta Stripe |
| `STRIPE_WEBHOOK_SECRET` | Segreto per validare i webhook Stripe |
| `ML_SERVER_URL` | URL del server Oracle Cloud (es. `http://1.2.3.4:8001`) |
| `ML_SERVER_SECRET` | Segreto autenticazione ML server |
| `ADMIN_EMAIL` | Email dell'account admin |
| `ADMIN_PASSWORD` | Password dell'account admin |
| `MODEL_PTH_URL` | URL per scaricare `model_best.pth` all'avvio |
| `UPLOAD_DIR` | Directory temporanea per i file caricati (default: `/tmp/elaborazioni`) |
