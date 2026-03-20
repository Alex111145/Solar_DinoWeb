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
