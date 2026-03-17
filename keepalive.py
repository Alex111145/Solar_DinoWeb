"""
SolarDino — Keep-alive script
Pinga il server ogni 10 minuti per evitare lo spin-down di Render.
Esegui con: python3 keepalive.py
"""
import time
import urllib.request
import urllib.error
from datetime import datetime

URL = "https://solar-dinoweb.onrender.com/health"
INTERVAL = 10 * 60  # 10 minuti

def ping():
    try:
        with urllib.request.urlopen(URL, timeout=15) as res:
            status = res.status
            print(f"[{datetime.now().strftime('%H:%M:%S')}] ✅ OK — HTTP {status}")
    except urllib.error.HTTPError as e:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] ⚠️  HTTP {e.code}")
    except Exception as e:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] ❌ Errore: {e}")

if __name__ == "__main__":
    print(f"Keep-alive avviato → {URL}")
    print(f"Ping ogni {INTERVAL // 60} minuti. Ctrl+C per fermare.\n")
    while True:
        ping()
        time.sleep(INTERVAL)
