#!/bin/bash
# ══════════════════════════════════════════════════════════════
#  SolarDino ML Server — Setup su Oracle Cloud Always Free ARM
#  Esegui una sola volta dopo aver creato la VM Ampere A1
# ══════════════════════════════════════════════════════════════
set -e

echo "=== [1/6] Aggiornamento sistema ==="
sudo apt update && sudo apt upgrade -y
sudo apt install -y git python3.11 python3.11-venv python3-pip build-essential libgdal-dev

echo "=== [2/6] Clone repository ==="
# Modifica con il tuo repo
git clone https://github.com/Alex111145/Solar_DinoWeb.git /opt/solardino
cd /opt/solardino

echo "=== [3/6] Virtual environment e dipendenze ML ==="
python3.11 -m venv /opt/solardino/venv
source /opt/solardino/venv/bin/activate
pip install --upgrade pip
pip install -r ml_server/requirements.txt

echo "=== [4/6] File .env ==="
# Copia le variabili necessarie
cat > /opt/solardino/.env << 'ENVEOF'
DATABASE_URL=postgresql://postgres.msyvtrsgxfderbyametg:87l89ifA!!!@aws-1-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require
SUPABASE_URL=https://msyvtrsgxfderbyametg.supabase.co
SUPABASE_SERVICE_KEY=INSERISCI_QUI
SUPABASE_BUCKET=pth
ML_SERVER_SECRET=SCEGLI_UNA_PASSWORD_SEGRETA
MODEL_PTH_URL=INSERISCI_URL_MODELLO
TMP_DIR=/tmp/ml_jobs
WEIGHTS_DIR=/opt/solardino/weights
ENVEOF
echo ">>> Modifica /opt/solardino/.env con le tue credenziali!"

echo "=== [5/6] Systemd service ==="
sudo tee /etc/systemd/system/solardino-ml.service > /dev/null << 'SVCEOF'
[Unit]
Description=SolarDino ML Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/opt/solardino
EnvironmentFile=/opt/solardino/.env
ExecStart=/opt/solardino/venv/bin/python -m uvicorn ml_server.main:app --host 0.0.0.0 --port 8001 --workers 1
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SVCEOF

sudo systemctl daemon-reload
sudo systemctl enable solardino-ml
sudo systemctl start solardino-ml

echo "=== [6/6] Firewall (porta 8001) ==="
sudo iptables -I INPUT -p tcp --dport 8001 -j ACCEPT
# Rendi persistente
sudo apt install -y iptables-persistent
sudo netfilter-persistent save

echo ""
echo "✅ ML Server avviato su http://$(curl -s ifconfig.me):8001"
echo "   Stato: sudo systemctl status solardino-ml"
echo "   Log:   sudo journalctl -u solardino-ml -f"
echo ""
echo "⚠️  Aggiungi ML_SERVER_URL=http://$(curl -s ifconfig.me):8001 nelle env dell'API"
echo "⚠️  Aggiungi ML_SERVER_SECRET (stessa password del .env) nelle env dell'API"
