import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
ADMIN_NOTIFY_EMAIL = os.getenv("ADMIN_EMAIL", "agervasini1@gmail.com")


def send_email(to: str, subject: str, html: str):
    if not SMTP_USER or not SMTP_PASS:
        print(f"[EMAIL] SMTP non configurato — skip invio a {to}")
        return
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = SMTP_USER
        msg["To"]      = to
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
            server.ehlo()
            server.starttls()
            server.login(SMTP_USER, SMTP_PASS)
            server.sendmail(SMTP_USER, to, msg.as_string())
        print(f"[EMAIL] Inviata a {to}: {subject}")
    except Exception as e:
        print(f"[EMAIL] Errore invio a {to}: {e}")


def notify_bonifico(company_name: str, company_email: str, package: str, amount_eur: float, credits: int):
    subject = f"SolarDino — Nuova richiesta bonifico da {company_name}"
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:16px;">
      <h2 style="color:#f59e0b;margin-top:0;">☀️ SolarDino — Nuovo Bonifico</h2>
      <p style="color:#94a3b8;">È arrivata una nuova richiesta di pagamento via bonifico.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Azienda</td>
            <td style="padding:8px 0;font-weight:600;">{company_name}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Email</td>
            <td style="padding:8px 0;">{company_email}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Pacchetto</td>
            <td style="padding:8px 0;">{package.upper()}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Importo</td>
            <td style="padding:8px 0;color:#34d399;font-weight:700;font-size:18px;">€{amount_eur:.2f}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Crediti</td>
            <td style="padding:8px 0;color:#fbbf24;font-weight:600;">{credits} ortomosaici</td></tr>
      </table>
      <p style="color:#94a3b8;font-size:13px;">La ricevuta è allegata alla richiesta. Accedi al pannello admin per approvarla.</p>
      <p style="margin-top:24px;font-size:12px;color:#475569;">SolarDino © 2026</p>
    </div>
    """
    send_email(ADMIN_NOTIFY_EMAIL, subject, html)
