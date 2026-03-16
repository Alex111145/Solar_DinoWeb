from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text
)
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
from database import Base


class Company(Base):
    __tablename__ = "companies"

    id                 = Column(Integer, primary_key=True, index=True)
    email              = Column(String, unique=True, index=True, nullable=False)
    name               = Column(String, nullable=False)
    ragione_sociale    = Column(String, nullable=True)
    vat_number         = Column(String, nullable=True, index=True)   # Partita IVA
    password_hash      = Column(String, nullable=False)
    stripe_customer_id = Column(String, nullable=True)
    credits            = Column(Integer, default=1)
    is_active          = Column(Boolean, default=True)
    deleted_at         = Column(DateTime, nullable=True)             # Soft delete
    last_ip            = Column(String, nullable=True)               # Ultimo IP di accesso
    created_at         = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    jobs               = relationship("Job", back_populates="company", cascade="all, delete")
    usage_logs         = relationship("UsageLog", back_populates="company", cascade="all, delete")
    bonifico_requests  = relationship("BonificoRequest", back_populates="company", cascade="all, delete")


class Job(Base):
    __tablename__ = "jobs"

    id              = Column(String, primary_key=True)   # UUID
    company_id      = Column(Integer, ForeignKey("companies.id"), nullable=False)
    status          = Column(String, default="in_coda")  # in_coda | taglio_tile | inferenza | completato | errore
    tif_filename    = Column(String, nullable=True)
    result_path     = Column(String, nullable=True)
    panels_detected = Column(Integer, nullable=True)
    hotspot_count   = Column(Integer, nullable=True, default=0)
    degraded_count  = Column(Integer, nullable=True, default=0)
    log             = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at    = Column(DateTime, nullable=True)

    company   = relationship("Company", back_populates="jobs")
    usage_log = relationship("UsageLog", back_populates="job", uselist=False)


class BonificoRequest(Base):
    __tablename__ = "bonifico_requests"

    id          = Column(Integer, primary_key=True, index=True)
    company_id  = Column(Integer, ForeignKey("companies.id"), nullable=False)
    package     = Column(String, nullable=False)   # single | pack5 | pack10 | pack20 | pack100 | ...
    credits     = Column(Integer, nullable=False)
    amount_eur  = Column(Float, nullable=False)
    status       = Column(String, default="pending")  # pending | approved | rejected
    receipt_path = Column(String, nullable=True)       # path della ricevuta caricata
    created_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    approved_at  = Column(DateTime, nullable=True)

    company = relationship("Company", back_populates="bonifico_requests")


class UsageLog(Base):
    __tablename__ = "usage_logs"

    id           = Column(Integer, primary_key=True, index=True)
    company_id   = Column(Integer, ForeignKey("companies.id"), nullable=False)
    job_id       = Column(String, ForeignKey("jobs.id"), nullable=False)
    panels_count = Column(Integer, default=0)
    credits_used = Column(Integer, default=1)
    created_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company", back_populates="usage_logs")
    job     = relationship("Job", back_populates="usage_log")
