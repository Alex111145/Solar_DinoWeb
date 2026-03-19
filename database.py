import os
from sqlalchemy import create_engine
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
