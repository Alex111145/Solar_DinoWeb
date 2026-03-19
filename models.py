from sqlalchemy import (
    Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, Index
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
    is_active          = Column(Boolean, default=True, index=True)
    is_manager         = Column(Boolean, default=False, index=True)
    deleted_at         = Column(DateTime, nullable=True, index=True) # Soft delete — usato in quasi ogni query
    last_ip            = Column(String, nullable=True)               # Ultimo IP di accesso
    pec                  = Column(String, nullable=True)
    welcome_bonus_used   = Column(Boolean, default=False)
    last_login_at        = Column(DateTime, nullable=True)
    created_at           = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        # Indice composito per la query più frequente: aziende attive per P.IVA
        Index("ix_companies_vat_deleted", "vat_number", "deleted_at"),
    )

    jobs               = relationship("Job", back_populates="company", cascade="all, delete")
    usage_logs         = relationship("UsageLog", back_populates="company", cascade="all, delete")
    bonifico_requests  = relationship("BonificoRequest", back_populates="company", cascade="all, delete")


class Job(Base):
    __tablename__ = "jobs"

    id              = Column(String, primary_key=True)   # UUID
    company_id      = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    status          = Column(String, default="in_coda", index=True)  # in_coda | taglio_tile | inferenza | completato | errore
    tif_filename    = Column(String, nullable=True)
    result_path     = Column(String, nullable=True)
    panels_detected = Column(Integer, nullable=True)
    hotspot_count   = Column(Integer, nullable=True, default=0)
    degraded_count  = Column(Integer, nullable=True, default=0)
    log             = Column(Text, nullable=True)
    # Dati opzionali impianto
    panel_model     = Column(String, nullable=True)   # Marca e modello
    panel_dimensions= Column(String, nullable=True)   # Dimensioni fisiche (LxH mm)
    panel_efficiency= Column(Float,  nullable=True)   # Efficienza nominale %
    panel_temp_coeff= Column(Float,  nullable=True)   # Coefficiente temperatura %/°C
    created_at      = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at    = Column(DateTime, nullable=True)

    company   = relationship("Company", back_populates="jobs")
    usage_log = relationship("UsageLog", back_populates="job", uselist=False)


class BonificoRequest(Base):
    __tablename__ = "bonifico_requests"

    id          = Column(Integer, primary_key=True, index=True)
    company_id  = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    package     = Column(String, nullable=False)   # single | pack5 | pack10 | pack20 | pack100 | ...
    credits     = Column(Integer, nullable=False)
    amount_eur  = Column(Float, nullable=False)
    status       = Column(String, default="pending", index=True)  # pending | approved | rejected
    receipt_path = Column(String, nullable=True)       # path della ricevuta caricata
    created_at   = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    approved_at  = Column(DateTime, nullable=True)

    company = relationship("Company", back_populates="bonifico_requests")


class Review(Base):
    __tablename__ = "reviews"

    id         = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False, index=True)
    stars      = Column(Integer, nullable=False)
    comment    = Column(Text, nullable=True)
    status     = Column(String, default="pending", index=True)  # pending | approved | rejected
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company")


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


# ── FlightHub 2 Enterprise Integration ──────────────────────────────────────

class FlightHubConnection(Base):
    """Credenziali DJI FlightHub 2 salvate per azienda."""
    __tablename__ = "flighthub_connections"

    id            = Column(Integer, primary_key=True, index=True)
    company_id    = Column(Integer, ForeignKey("companies.id"), unique=True, nullable=False)
    workspace_id  = Column(String, nullable=False)   # DJI Workspace ID
    client_id     = Column(String, nullable=False)   # OAuth2 client_id
    client_secret = Column(String, nullable=False)   # OAuth2 client_secret
    access_token  = Column(Text,   nullable=True)    # token corrente (cache)
    token_expires = Column(DateTime, nullable=True)  # scadenza token
    last_sync_at  = Column(DateTime, nullable=True)  # ultima sincronizzazione
    created_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company")


class FlightHubJob(Base):
    """Job originato da DJI FlightHub 2 (mappa scaricata automaticamente)."""
    __tablename__ = "flighthub_jobs"

    id               = Column(Integer, primary_key=True, index=True)
    company_id       = Column(Integer, ForeignKey("companies.id"), nullable=False)
    fh_mission_id    = Column(String, nullable=False)   # ID missione su DJI
    fh_map_id        = Column(String, nullable=False)   # ID mappa su DJI
    fh_map_name      = Column(String, nullable=True)    # nome mappa
    job_id           = Column(String, ForeignKey("jobs.id"), nullable=True)  # job interno
    # pending | downloading | processing | uploading | done | error
    status           = Column(String, default="pending")
    error_msg        = Column(Text, nullable=True)
    results_uploaded = Column(Boolean, default=False)
    created_at       = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    completed_at     = Column(DateTime, nullable=True)

    company = relationship("Company")
    job     = relationship("Job")


class TrialRequest(Base):
    """Richiesta di prova gratuita da parte di un'azienda."""
    __tablename__ = "trial_requests"

    id         = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    ip         = Column(String, nullable=False, index=True)
    message    = Column(Text, nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company")


class PecVerificationToken(Base):
    """Token per verificare la PEC aziendale alla registrazione."""
    __tablename__ = "pec_verification_tokens"

    id         = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    token      = Column(String, unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used       = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company")


class EmailChangeToken(Base):
    """Token temporaneo per confermare il cambio email."""
    __tablename__ = "email_change_tokens"

    id         = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    new_email  = Column(String, nullable=False)
    token      = Column(String, unique=True, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used       = Column(Boolean, default=False)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company")


class SupportTicket(Base):
    """Richiesta di assistenza inviata da un'azienda."""
    __tablename__ = "support_tickets"

    id         = Column(Integer, primary_key=True, index=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    subject    = Column(String, nullable=False)
    message    = Column(Text, nullable=False)
    status     = Column(String, default="aperto")   # aperto | in_elaborazione | risolto
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company")


class StripePayment(Base):
    """Pagamento Stripe completato (registrato dal webhook)."""
    __tablename__ = "stripe_payments"

    id             = Column(Integer, primary_key=True, index=True)
    company_id     = Column(Integer, ForeignKey("companies.id"), nullable=False)
    stripe_session = Column(String, nullable=True, unique=True)
    package        = Column(String, nullable=False)
    credits        = Column(Integer, nullable=False)
    amount_eur     = Column(Float, nullable=False)
    created_at     = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company")


class EnterpriseInferenceLog(Base):
    """Log di ogni avvio inferenza Enterprise con consenso al riutilizzo dati."""
    __tablename__ = "enterprise_inference_logs"

    id              = Column(Integer, primary_key=True, index=True)
    company_id      = Column(Integer, ForeignKey("companies.id"), nullable=False)
    company_name    = Column(String, nullable=True)
    company_email   = Column(String, nullable=True)
    vat_number      = Column(String, nullable=True)
    fh_workspace_id = Column(String, nullable=True)
    data_consent    = Column(Boolean, default=True)   # ha accettato riutilizzo dati
    created_at      = Column(DateTime, default=lambda: datetime.now(timezone.utc))

    company = relationship("Company")
