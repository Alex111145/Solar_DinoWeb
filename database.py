import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    raise RuntimeError("DATABASE_URL non configurata — imposta la variabile d'ambiente nel file .env")

# Render usa "postgres://" ma SQLAlchemy richiede "postgresql://"
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# Supabase Transaction Pooler: porta 6543 invece di 5432
# Decommentare in produzione se il Transaction Pooler è abilitato su Supabase
# if "pooler.supabase.com:5432" in DATABASE_URL:
#     DATABASE_URL = DATABASE_URL.replace(":5432/", ":6543/")

def run_migrations(engine):
    """Applica colonne mancanti — idempotente (IF NOT EXISTS)."""
    ddl = [
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_cancelled BOOLEAN DEFAULT FALSE",
        "ALTER TABLE companies ADD COLUMN IF NOT EXISTS welcome_bonus_requested BOOLEAN DEFAULT FALSE",
        """CREATE TABLE IF NOT EXISTS welcome_bonus_requests (
            id SERIAL PRIMARY KEY,
            company_id INTEGER NOT NULL REFERENCES companies(id),
            status VARCHAR DEFAULT 'pending',
            ip VARCHAR,
            created_at TIMESTAMP DEFAULT NOW()
        )""",
    ]
    with engine.connect() as conn:
        for sql in ddl:
            try:
                conn.execute(text(sql))
            except Exception as e:
                print(f"[MIGRATION] {e}")
        conn.commit()

    # Popola welcome_bonus_requests per aziende con welcome_bonus_requested=True
    # ma senza record nella tabella (idempotente)
    seed_sql = """
        INSERT INTO welcome_bonus_requests (company_id, status, ip, created_at)
        SELECT c.id,
               CASE WHEN c.welcome_bonus_used THEN 'approved' ELSE 'pending' END,
               c.last_ip,
               COALESCE(c.last_login_at, c.created_at)
        FROM companies c
        WHERE c.welcome_bonus_requested = TRUE
          AND c.deleted_at IS NULL
          AND NOT EXISTS (
              SELECT 1 FROM welcome_bonus_requests r WHERE r.company_id = c.id
          )
    """
    with engine.connect() as conn:
        try:
            conn.execute(text(seed_sql))
            conn.commit()
        except Exception as e:
            print(f"[SEED bonus] {e}")


engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,       # connessioni persistenti (era 5)
    max_overflow=20,    # connessioni extra sotto picco (era 10)
    pool_timeout=20,
    pool_recycle=300,
    connect_args={"connect_timeout": 10},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
