#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
#  SolarDino — Setup completo su Oracle Cloud Always Free ARM (Ubuntu 22.04)
#  Installa: API backend (porta 8000) + ML server (porta 8001) + nginx (porta 80)
#
#  Esegui UNA SOLA VOLTA dopo aver creato la VM:
#    chmod +x setup_oracle_full.sh && sudo ./setup_oracle_full.sh
# ══════════════════════════════════════════════════════════════════════════════
set -e

REPO_URL="https://github.com/Alex111145/Solar_DinoWeb.git"
INSTALL_DIR="/opt/solardino"
USER="ubuntu"

echo ""
echo "╔══════════════════════════════════════════════╗"
echo "║      SolarDino — Setup Oracle Cloud          ║"
echo "╚══════════════════════════════════════════════╝"
echo ""

# ── [1/8] Sistema base ────────────────────────────────────────────────────────
echo "=== [1/8] Aggiornamento sistema ==="
apt update && apt upgrade -y
apt install -y git python3.11 python3.11-venv python3-pip \
    build-essential libgdal-dev nginx curl iptables-persistent

# ── [2/8] Clone repository ───────────────────────────────────────────────────
echo "=== [2/8] Clone repository ==="
if [ -d "$INSTALL_DIR" ]; then
    echo "Directory già presente — pull aggiornamenti"
    cd "$INSTALL_DIR" && git pull
else
    git clone "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ── [3/8] Venv API backend ───────────────────────────────────────────────────
echo "=== [3/8] Dipendenze API backend ==="
python3.11 -m venv "$INSTALL_DIR/venv_api"
source "$INSTALL_DIR/venv_api/bin/activate"
pip install --upgrade pip
pip install -r requirements.txt
deactivate

# ── [4/8] Venv ML server ─────────────────────────────────────────────────────
echo "=== [4/8] Dipendenze ML server (PyTorch CPU — può richiedere 5-10 min) ==="
python3.11 -m venv "$INSTALL_DIR/venv_ml"
source "$INSTALL_DIR/venv_ml/bin/activate"
pip install --upgrade pip
pip install -r ml_server/requirements.txt
deactivate

# ── [5/8] File .env ──────────────────────────────────────────────────────────
echo "=== [5/8] Configurazione variabili d'ambiente ==="
if [ ! -f "$INSTALL_DIR/.env" ]; then
    cat > "$INSTALL_DIR/.env" << 'ENVEOF'
# ── Database ──────────────────────────────────────────────────────────────────
DATABASE_URL=INSERISCI_QUI

# ── Supabase Storage ──────────────────────────────────────────────────────────
SUPABASE_URL=INSERISCI_QUI
SUPABASE_SERVICE_KEY=INSERISCI_QUI
SUPABASE_BUCKET=pth

# ── Stripe ────────────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=INSERISCI_QUI
STRIPE_WEBHOOK_SECRET=INSERISCI_QUI

# ── Admin ─────────────────────────────────────────────────────────────────────
ADMIN_EMAIL=admin@solardino.it
ADMIN_PASSWORD=SCEGLI_PASSWORD_SICURA

# ── ML Server (stesso host — non cambiare) ────────────────────────────────────
ML_SERVER_URL=http://127.0.0.1:8001
ML_SERVER_SECRET=SCEGLI_SEGRETO_LUNGO

# ── ML Config ─────────────────────────────────────────────────────────────────
MODEL_PTH_URL=INSERISCI_URL_MODELLO
TMP_DIR=/tmp/ml_jobs
WEIGHTS_DIR=/opt/solardino/weights
UPLOAD_DIR=/tmp/elaborazioni
ENVEOF
    echo ""
    echo "⚠️  FILE .env CREATO — devi compilarlo prima di continuare:"
    echo "    nano $INSTALL_DIR/.env"
    echo ""
    echo "Premi INVIO quando hai salvato il .env..."
    read -r
else
    echo ">>> .env già presente — salto creazione"
fi
chmod 600 "$INSTALL_DIR/.env"

# ── [6/8] Servizi systemd ────────────────────────────────────────────────────
echo "=== [6/8] Creazione servizi systemd ==="

# API backend
tee /etc/systemd/system/solardino-api.service > /dev/null << SVCEOF
[Unit]
Description=SolarDino API Backend
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/venv_api/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 2
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

# ML server
tee /etc/systemd/system/solardino-ml.service > /dev/null << SVCEOF
[Unit]
Description=SolarDino ML Server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$INSTALL_DIR/.env
ExecStart=$INSTALL_DIR/venv_ml/bin/python -m uvicorn ml_server.main:app --host 127.0.0.1 --port 8001 --workers 1
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable solardino-api solardino-ml
systemctl start solardino-api solardino-ml

# ── [7/8] Nginx ──────────────────────────────────────────────────────────────
echo "=== [7/8] Configurazione nginx ==="

PUBLIC_IP=$(curl -s ifconfig.me)

tee /etc/nginx/sites-available/solardino > /dev/null << NGINXEOF
server {
    listen 80;
    server_name $PUBLIC_IP _;

    # Aumenta limite upload per i file TIF (fino a 2GB)
    client_max_body_size 2048M;
    client_body_timeout 300s;
    proxy_read_timeout 300s;
    proxy_send_timeout 300s;

    location / {
        proxy_pass         http://127.0.0.1:8000;
        proxy_set_header   Host \$host;
        proxy_set_header   X-Real-IP \$remote_addr;
        proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_buffering    off;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/solardino /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── [8/8] Firewall ───────────────────────────────────────────────────────────
echo "=== [8/8] Firewall ==="
# Apri solo porta 80 (nginx) e 22 (SSH) dall'esterno
# Le porte 8000 e 8001 restano interne (127.0.0.1 only)
iptables -I INPUT -p tcp --dport 80 -j ACCEPT
iptables -I INPUT -p tcp --dport 443 -j ACCEPT
iptables -I INPUT -p tcp --dport 22 -j ACCEPT
netfilter-persistent save

# ── Fine ─────────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✅  Setup completato!                                       ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  API backend:  http://$PUBLIC_IP"
echo "  ML server:    interno (127.0.0.1:8001)"
echo ""
echo "  Comandi utili:"
echo "    sudo systemctl status solardino-api"
echo "    sudo systemctl status solardino-ml"
echo "    sudo journalctl -u solardino-api -f"
echo "    sudo journalctl -u solardino-ml -f"
echo "    sudo systemctl restart solardino-api"
echo ""
echo "  Per aggiornare dopo un git push:"
echo "    cd /opt/solardino && git pull"
echo "    sudo systemctl restart solardino-api solardino-ml"
echo ""
