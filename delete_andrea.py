import os, sys
sys.path.insert(0, '/Users/alessiogervasini/Desktop/solardino_web')
from dotenv import load_dotenv
load_dotenv('/Users/alessiogervasini/Desktop/solardino_web/.env', override=True)
import psycopg2
conn = psycopg2.connect(os.getenv('DATABASE_URL'))
cur = conn.cursor()
cur.execute("DELETE FROM companies WHERE ragione_sociale ILIKE '%Andrea GERVASINI%' OR name ILIKE '%Andrea GERVASINI%'")
print(f"Deleted: {cur.rowcount} rows")
conn.commit()
cur.close()
conn.close()
