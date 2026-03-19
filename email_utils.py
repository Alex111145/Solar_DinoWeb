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


def _wrap(title_bar: str, body: str, preheader: str = "") -> str:
    """Shared email shell — consistent branding across all templates."""
    return f"""<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>SolarDino</title>
</head>
<body style="margin:0;padding:0;background:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  {f'<div style="display:none;max-height:0;overflow:hidden;color:#eef2f7;">{preheader}</div>' if preheader else ""}
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#eef2f7;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="max-width:600px;width:100%;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 8px 40px rgba(0,0,0,0.10);">

        <!-- ── HEADER ── -->
        <tr>
          <td style="background:linear-gradient(135deg,#0b1120 0%,#1a2540 100%);padding:36px 40px;text-align:center;">
            <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td align="center">
                  <div style="display:inline-block;background:rgba(245,158,11,0.15);border:2px solid rgba(245,158,11,0.35);border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;text-align:center;margin-bottom:12px;">&#9728;&#65039;</div>
                  <div style="font-size:26px;font-weight:800;color:#f59e0b;letter-spacing:-0.5px;line-height:1.1;">SolarDino</div>
                  <div style="font-size:11px;font-weight:500;color:#64748b;letter-spacing:2px;text-transform:uppercase;margin-top:4px;">Analisi Fotovoltaica con AI</div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- ── TITLE BAR ── -->
        <tr>
          <td style="background:linear-gradient(90deg,#f59e0b 0%,#fbbf24 100%);padding:16px 40px;">
            <div style="font-size:14px;font-weight:700;color:#0b1120;letter-spacing:0.5px;text-transform:uppercase;">{title_bar}</div>
          </td>
        </tr>

        <!-- ── BODY ── -->
        <tr>
          <td style="padding:36px 40px;">
            {body}
          </td>
        </tr>

        <!-- ── FOOTER ── -->
        <tr>
          <td style="background:#0b1120;padding:28px 40px;text-align:center;">
            <div style="font-size:12px;color:#475569;">
              <strong style="color:#64748b;">SolarDino</strong> &copy; 2026 &nbsp;&middot;&nbsp; Tutti i diritti riservati
            </div>
            <div style="font-size:11px;color:#334155;margin-top:6px;">
              Questa &egrave; un&rsquo;email automatica &mdash; si prega di non rispondere.
            </div>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>"""


def _info_row(label: str, value: str, value_style: str = "") -> str:
    return f"""
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;color:#64748b;font-size:13px;width:40%;vertical-align:top;">{label}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:14px;font-weight:600;color:#1e293b;{value_style}">{value}</td>
    </tr>"""


def _info_table(*rows: str) -> str:
    return f"""
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
           style="border-collapse:collapse;margin:20px 0;">
      {''.join(rows)}
    </table>"""


def _message_box(text: str, accent: str = "#f59e0b") -> str:
    return f"""
    <div style="background:#f8fafc;border-left:4px solid {accent};border-radius:0 12px 12px 0;padding:18px 20px;margin:20px 0;">
      <p style="margin:0;color:#334155;font-size:14px;line-height:1.7;white-space:pre-wrap;">{text}</p>
    </div>"""


def _badge(text: str, bg: str = "#fef3c7", color: str = "#92400e") -> str:
    return f'<span style="display:inline-block;background:{bg};color:{color};font-size:11px;font-weight:700;padding:4px 10px;border-radius:999px;letter-spacing:0.5px;text-transform:uppercase;">{text}</span>'


def _cta_button(label: str, url: str) -> str:
    return f"""
    <table cellpadding="0" cellspacing="0" role="presentation" style="margin:28px auto 0;">
      <tr>
        <td style="background:#f59e0b;border-radius:10px;padding:14px 32px;text-align:center;">
          <a href="{url}" style="color:#0b1120;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;">{label}</a>
        </td>
      </tr>
    </table>"""


# ── Template 1: Pagamento Stripe (admin) ─────────────────────────────────────

def notify_stripe_payment(company_name: str, company_email: str, package: str, amount_eur: float, credits: int):
    subject = f"SolarDino — Pagamento ricevuto da {company_name}"
    credits_label = "Illimitati" if credits >= 9999 else str(credits)
    body = f"""
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">Pagamento confermato</p>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
      Un nuovo pagamento &egrave; stato completato automaticamente tramite Stripe.
    </p>
    {_info_table(
        _info_row("Azienda", company_name),
        _info_row("Email", company_email),
        _info_row("Piano", _badge(package.upper())),
        _info_row("Importo", f"&euro;{amount_eur:.2f}", "color:#16a34a;font-size:20px;"),
        _info_row("Elaborazioni accreditate", f"{credits_label} ortomosaici", "color:#d97706;"),
    )}
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 20px;margin-top:8px;">
      <p style="margin:0;font-size:13px;color:#166534;">
        &#10003;&nbsp; I crediti sono stati accreditati automaticamente. Nessuna azione richiesta.
      </p>
    </div>
    """
    send_email(ADMIN_NOTIFY_EMAIL, subject, _wrap("Notifica Pagamento Stripe", body, f"Pagamento di €{amount_eur:.2f} da {company_name}"))


# ── Template 2: Nuovo ticket di supporto (admin) ──────────────────────────────

def notify_support_ticket(company_name: str, company_email: str, subject: str, message: str):
    email_subject = f"SolarDino — Nuova segnalazione da {company_name}"
    body = f"""
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">Nuova richiesta di assistenza</p>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
      Un cliente ha aperto una nuova segnalazione. Accedi al pannello admin per rispondere.
    </p>
    {_info_table(
        _info_row("Azienda", company_name),
        _info_row("Email", company_email),
        _info_row("Oggetto", f"<strong>{subject}</strong>"),
    )}
    <div style="margin-top:4px;">
      <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Messaggio del cliente</div>
      {_message_box(message, "#3b82f6")}
    </div>
    """
    send_email(ADMIN_NOTIFY_EMAIL, email_subject, _wrap("Nuova Segnalazione", body, f"Segnalazione da {company_name}: {subject}"))


# ── Template 3: Richiesta bonifico (admin) ────────────────────────────────────

def notify_bonifico(company_name: str, company_email: str, package: str, amount_eur: float, credits: int):
    subject = f"SolarDino — Richiesta bonifico da {company_name}"
    body = f"""
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">Nuova richiesta di pagamento via bonifico</p>
    <p style="margin:0 0 20px;font-size:14px;color:#64748b;line-height:1.6;">
      &Egrave; arrivata una nuova richiesta di bonifico. Verifica la ricevuta e approva dal pannello admin.
    </p>
    {_info_table(
        _info_row("Azienda", company_name),
        _info_row("Email", company_email),
        _info_row("Piano richiesto", _badge(package.upper())),
        _info_row("Importo atteso", f"&euro;{amount_eur:.2f}", "color:#16a34a;font-size:20px;"),
        _info_row("Crediti da accreditare", f"{credits} ortomosaici", "color:#d97706;"),
    )}
    <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:16px 20px;margin-top:8px;">
      <p style="margin:0;font-size:13px;color:#92400e;">
        &#9888;&nbsp; La ricevuta &egrave; stata allegata alla richiesta. Accedi al pannello admin per approvarla e accreditare i crediti.
      </p>
    </div>
    """
    send_email(ADMIN_NOTIFY_EMAIL, subject, _wrap("Richiesta Bonifico", body, f"Bonifico di €{amount_eur:.2f} da {company_name}"))


# ── Template 4: Ricevuta abbonamento (cliente) ────────────────────────────────

def notify_subscription_receipt(company_name: str, company_email: str, plan: str, amount_eur: float, credits: int):
    plan_label = {"starter": "Starter", "medium": "Medium", "unlimited": "Unlimited", "unlimited_annual": "Annual"}.get(plan, plan.upper())
    credits_label = "Illimitati" if credits >= 9999 else f"{credits} ortomosaici/mese"
    plan_colors = {
        "starter":   ("#eff6ff", "#1d4ed8", "#1d4ed8"),
        "medium":    ("#f0fdf4", "#15803d", "#15803d"),
        "unlimited": ("#fdf4ff", "#7c3aed", "#7c3aed"),
    }
    bg, fg, accent = plan_colors.get(plan, ("#f8fafc", "#0f172a", "#f59e0b"))

    subject = f"SolarDino — Abbonamento {plan_label} attivato"
    body = f"""
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">Ciao {company_name},</p>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
      Il tuo abbonamento &egrave; stato attivato con successo. Di seguito trovi il riepilogo del tuo piano.
    </p>

    <!-- Piano card -->
    <div style="background:{bg};border:2px solid {accent};border-radius:16px;padding:24px;text-align:center;margin-bottom:24px;">
      <div style="font-size:11px;font-weight:700;color:{fg};letter-spacing:2px;text-transform:uppercase;margin-bottom:6px;">Piano attivo</div>
      <div style="font-size:32px;font-weight:800;color:{fg};line-height:1.1;">{plan_label}</div>
      <div style="font-size:22px;font-weight:700;color:{fg};margin-top:10px;">&euro;{amount_eur:.2f}<span style="font-size:13px;font-weight:400;">/mese</span></div>
      <div style="font-size:13px;color:{fg};margin-top:8px;opacity:0.8;">{credits_label}</div>
    </div>

    {_info_table(
        _info_row("Elaborazioni incluse", credits_label, f"color:{accent};"),
        _info_row("Importo addebitato", f"&euro;{amount_eur:.2f}/mese", "color:#16a34a;font-size:18px;"),
        _info_row("Rinnovo automatico", "Ogni mese &mdash; gestisci dalla dashboard"),
    )}

    <div style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin-top:4px;">
      <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
        Puoi modificare o annullare il tuo abbonamento in qualsiasi momento dalla sezione
        <strong style="color:#0f172a;">&ldquo;Gestione abbonamento&rdquo;</strong> nella tua dashboard.
      </p>
    </div>
    """
    send_email(company_email, subject, _wrap(f"Abbonamento {plan_label} Attivato", body, f"Il tuo piano {plan_label} è attivo — {credits_label}"))


# ── Template 5: Risposta al ticket (cliente) ─────────────────────────────────

def notify_ticket_reply(company_email: str, company_name: str, ticket_id: int, ticket_subject: str, reply_text: str):
    subject = f"SolarDino — Risposta alla segnalazione #{ticket_id}"
    body = f"""
    <p style="margin:0 0 6px;font-size:16px;font-weight:700;color:#0f172a;">Ciao {company_name},</p>
    <p style="margin:0 0 24px;font-size:14px;color:#64748b;line-height:1.6;">
      Il team SolarDino ha risposto alla tua segnalazione. Leggi di seguito la risposta.
    </p>
    {_info_table(
        _info_row("Segnalazione", f"#{ticket_id} &mdash; {ticket_subject}"),
    )}
    <div style="margin-top:4px;">
      <div style="font-size:11px;font-weight:700;color:#94a3b8;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Risposta del team SolarDino</div>
      {_message_box(reply_text, "#f59e0b")}
    </div>
    <div style="background:#f8fafc;border-radius:12px;padding:16px 20px;margin-top:8px;">
      <p style="margin:0;font-size:13px;color:#64748b;line-height:1.6;">
        Puoi visualizzare la conversazione completa nella sezione <strong style="color:#0f172a;">Notifiche</strong> del tuo account.
        Se hai ulteriori domande, rispondi direttamente dalla dashboard.
      </p>
    </div>
    """
    send_email(company_email, subject, _wrap("Risposta alla Segnalazione", body, f"Risposta al ticket #{ticket_id}: {ticket_subject}"))
