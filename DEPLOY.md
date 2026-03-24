# Procedura di Deploy — SolarDino

## Architettura
- **API + Frontend** → Fly.io (`solar-dinoweb`)
- **ML Server** → Modal Serverless (`solardino-ml`)
- **Database + Storage** → Supabase

---

## 1. Modifiche al Backend (Python / API)

File coinvolti: `main.py`, `routers/`, `models.py`, `database.py`, `auth_utils.py`, `storage_utils.py`, `requirements.txt`

```bash
fly deploy --app solar-dinoweb
```

Se hai aggiunto un nuovo pacchetto, aggiungilo prima a `requirements.txt`.

---

## 2. Modifiche al Frontend (React)

File coinvolti: `frontend/src/`

```bash
# 1. Build del frontend
cd frontend
npm run build

# 2. Copia il build nella cartella static
cp -r dist/* ../static/app/

# 3. Torna alla root e deploya
cd ..
fly deploy --app solar-dinoweb
```

---

## 3. Modifiche al ML Server

File coinvolti: `ml_server/modal_handler.py`, `core/`, `models.py`, `storage_utils.py`

```bash
modal deploy ml_server/modal_handler.py
```

> Dopo il deploy Modal mostra l'URL del endpoint. Se cambia, aggiorna il secret su Fly:
> ```bash
> fly secrets set MODAL_ENDPOINT_URL="https://..." --app solar-dinoweb
> ```

---

## Comandi utili

```bash
# Vedere i log in tempo reale
fly logs --app solar-dinoweb

# Vedere i secrets settati
fly secrets list --app solar-dinoweb

# Aggiungere/modificare un secret
fly secrets set NOME="valore" --app solar-dinoweb

# Aprire la dashboard Modal
open https://modal.com/apps/alessio-gervasini45/main/deployed/solardino-ml
```
