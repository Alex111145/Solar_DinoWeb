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


def notify_stripe_payment(company_name: str, company_email: str, package: str, amount_eur: float, credits: int):
    subject = f"SolarDino — Pagamento Stripe ricevuto da {company_name}"
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:16px;">
      <h2 style="color:#f59e0b;margin-top:0;">☀️ SolarDino — Pagamento Stripe</h2>
      <p style="color:#94a3b8;">Pagamento confermato automaticamente via Stripe.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Azienda</td>
            <td style="padding:8px 0;font-weight:600;">{company_name}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Email</td>
            <td style="padding:8px 0;">{company_email}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Pacchetto</td>
            <td style="padding:8px 0;">{package.upper()}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Importo</td>
            <td style="padding:8px 0;color:#34d399;font-weight:700;font-size:18px;">€{amount_eur:.2f}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Crediti accreditati</td>
            <td style="padding:8px 0;color:#fbbf24;font-weight:600;">{credits} ortomosaici</td></tr>
      </table>
      <p style="color:#94a3b8;font-size:13px;">I crediti sono stati accreditati automaticamente. Nessuna azione richiesta.</p>
      <p style="margin-top:24px;font-size:12px;color:#475569;">SolarDino © 2026</p>
    </div>
    """
    send_email(ADMIN_NOTIFY_EMAIL, subject, html)


def notify_support_ticket(company_name: str, company_email: str, subject: str, message: str):
    email_subject = f"SolarDino — Richiesta assistenza da {company_name}"
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:16px;">
      <h2 style="color:#f59e0b;margin-top:0;">&#9728;&#65039; SolarDino — Assistenza</h2>
      <p style="color:#94a3b8;">Nuova richiesta di supporto ricevuta.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:120px;">Azienda</td>
            <td style="padding:8px 0;font-weight:600;">{company_name}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Email</td>
            <td style="padding:8px 0;">{company_email}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Oggetto</td>
            <td style="padding:8px 0;font-weight:600;">{subject}</td></tr>
      </table>
      <div style="background:#1e293b;border-radius:10px;padding:16px;margin-top:8px;">
        <div style="color:#64748b;font-size:12px;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;">Messaggio</div>
        <p style="color:#e2e8f0;margin:0;white-space:pre-wrap;font-size:14px;line-height:1.6;">{message}</p>
      </div>
      <p style="margin-top:24px;font-size:12px;color:#475569;">SolarDino &copy; 2026</p>
    </div>
    """
    send_email(ADMIN_NOTIFY_EMAIL, email_subject, html)


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


def notify_subscription_receipt(company_name: str, company_email: str, plan: str, amount_eur: float, credits: int):
    plan_label = {"starter": "Starter", "medium": "Medium", "unlimited": "Unlimited"}.get(plan, plan.upper())
    credits_label = "Illimitati" if credits >= 9999 else f"{credits} ortomosaici/mese"
    subject = f"SolarDino — Ricevuta abbonamento {plan_label}"
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:16px;">
      <h2 style="color:#f59e0b;margin-top:0;">☀️ SolarDino — Abbonamento attivato</h2>
      <p style="color:#94a3b8;">Ciao {company_name}, il tuo abbonamento è stato attivato con successo.</p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;">
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Piano</td>
            <td style="padding:8px 0;font-weight:600;">{plan_label}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Elaborazioni incluse</td>
            <td style="padding:8px 0;color:#fbbf24;font-weight:600;">{credits_label}</td></tr>
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;">Importo addebitato</td>
            <td style="padding:8px 0;color:#34d399;font-weight:700;font-size:18px;">€{amount_eur:.2f}/mese</td></tr>
      </table>
      <p style="color:#94a3b8;font-size:13px;">Puoi gestire o annullare il tuo abbonamento in qualsiasi momento dalla sezione "Gestione abbonamento" nella tua dashboard.</p>
      <p style="margin-top:24px;font-size:12px;color:#475569;">SolarDino © 2026</p>
    </div>
    """
    send_email(company_email, subject, html)


def notify_ticket_reply(company_email: str, company_name: str, ticket_id: int, ticket_subject: str, reply_text: str):
    subject = f"SolarDino — Risposta alla tua segnalazione #{ticket_id}"
    html = f"""
    <div style="font-family:sans-serif;max-width:520px;margin:auto;background:#0f172a;color:#e2e8f0;padding:32px;border-radius:16px;">
      <h2 style="color:#f59e0b;margin-top:0;">&#9728;&#65039; SolarDino — Risposta alla segnalazione</h2>
      <p style="color:#94a3b8;">Ciao {company_name}, il team SolarDino ha risposto alla tua segnalazione.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr><td style="padding:8px 0;color:#64748b;font-size:13px;width:100px;">Ticket</td>
            <td style="padding:8px 0;font-weight:600;">#{ticket_id} &mdash; {ticket_subject}</td></tr>
      </table>
      <div style="background:#1e293b;border-left:3px solid #f59e0b;padding:16px;border-radius:8px;margin:16px 0;">
        <p style="color:#e2e8f0;margin:0;white-space:pre-wrap;font-size:14px;line-height:1.6;">{reply_text}</p>
      </div>
      <p style="color:#94a3b8;font-size:13px;">Puoi visualizzare la risposta anche nella sezione Notifiche del tuo account.</p>
      <p style="margin-top:24px;font-size:12px;color:#475569;">SolarDino &copy; 2026</p>
    </div>
    """
    send_email(company_email, subject, html)
