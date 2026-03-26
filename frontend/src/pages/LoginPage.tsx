import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, Zap, MapPin, FileDown, Eye, EyeOff, Star, Moon,
  Upload, Radio, Check, X, Shield, Clock, BarChart2,
} from 'lucide-react'

interface Review { id: string; company?: string; stars: number; comment?: string }

function buildTheme(dark: boolean) {
  return dark ? {
    pageBg: '#060912',
    navBg: 'rgba(6,9,18,0.85)',
    text: '#f1f5f9',
    textSec: '#94a3b8',
    textMuted: '#64748b',
    textFaint: '#475569',
    cardBg: 'rgba(255,255,255,0.03)',
    cardBorder: 'rgba(255,255,255,0.07)',
    formBg: '#0d1117',
    formBorder: 'rgba(255,255,255,0.1)',
    toggleColor: '#94a3b8',
    orb1: 'rgba(245,158,11,0.12)',
    orb2: 'rgba(249,115,22,0.09)',
    iconBg: 'rgba(245,158,11,0.12)',
    iconBorder: 'rgba(245,158,11,0.2)',
    disabledBg: 'rgba(249,115,22,0.1)',
    disabledBorder: 'rgba(249,115,22,0.3)',
    disabledColor: '#f97316',
    errorBg: 'rgba(239,68,68,0.1)',
    errorBorder: 'rgba(239,68,68,0.3)',
    errorColor: '#ef4444',
    sectionBg: 'rgba(255,255,255,0.015)',
  } : {
    pageBg: '#f1f5f9',
    navBg: 'rgba(241,245,249,0.9)',
    text: '#1e293b',
    textSec: '#334155',
    textMuted: '#64748b',
    textFaint: '#94a3b8',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    formBg: '#ffffff',
    formBorder: '#e2e8f0',
    toggleColor: '#64748b',
    orb1: 'rgba(245,158,11,0.08)',
    orb2: 'rgba(249,115,22,0.05)',
    iconBg: 'rgba(245,158,11,0.12)',
    iconBorder: 'rgba(245,158,11,0.2)',
    disabledBg: 'rgba(249,115,22,0.08)',
    disabledBorder: 'rgba(249,115,22,0.25)',
    disabledColor: '#f97316',
    errorBg: 'rgba(239,68,68,0.07)',
    errorBorder: 'rgba(239,68,68,0.25)',
    errorColor: '#dc2626',
    sectionBg: 'rgba(0,0,0,0.02)',
  }
}

const fadeUp = { hidden: { opacity: 0, y: 24 }, show: { opacity: 1, y: 0, transition: { duration: 0.55 } } }
const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.1 } } }

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [disabled, setDisabled] = useState(false)
  const [blockedModal, setBlockedModal] = useState(false)
  const [reviews, setReviews] = useState<Review[]>([])
  const [isDark, setIsDark] = useState(true)
  const [forceChangePwd, setForceChangePwd] = useState(false)
  const [forcePwdNew, setForcePwdNew] = useState('')
  const [forcePwdConfirm, setForcePwdConfirm] = useState('')
  const [forcePwdMsg, setForcePwdMsg] = useState('')
  const [forcePwdLoading, setForcePwdLoading] = useState(false)
  const [showLogin, setShowLogin] = useState(false)
  const [showRegister, setShowRegister] = useState(false)
  const [videoUrl, setVideoUrl] = useState<string | null>(null)

  // Consent state
  const [regConsent, setRegConsent] = useState(false)

  // Register form state
  const [regForm, setRegForm] = useState({ ragione_sociale: '', email: '', password: '' })
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState('')
  const [regErrors, setRegErrors] = useState<Record<string, string>>({})

  // IP warning popup (shown after login/register when same IP used by different company)
  const [showIpWarning, setShowIpWarning] = useState(false)

  const LEGAL_FORM_RE = /\b(srl|s\.r\.l\.?|spa|s\.p\.a\.?|snc|s\.n\.c\.?|sas|s\.a\.s\.?|srls|s\.r\.l\.s\.?|ss|s\.s\.?|coop|scarl|onlus|ets|di|e\.i\.?)\b/i

  function updateReg(k: string, v: string) {
    setRegForm((f) => ({ ...f, [k]: v }))
    if (regErrors[k]) setRegErrors((e) => ({ ...e, [k]: '' }))
  }

  function validateReg(): Record<string, string> {
    const e: Record<string, string> = {}
    const rs = regForm.ragione_sociale.trim()
    if (!rs) e.ragione_sociale = 'Campo obbligatorio'
    else if (rs.length < 3) e.ragione_sociale = 'Minimo 3 caratteri'
    else if (rs.length > 150) e.ragione_sociale = 'Massimo 150 caratteri'
    else if (!LEGAL_FORM_RE.test(rs)) e.ragione_sociale = 'Inserire la forma giuridica (es. Srl, Spa, Snc...)'
    if (!regForm.email.trim()) e.email = 'Obbligatoria'
    else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(regForm.email)) e.email = 'Email non valida'
    if (!regForm.password) e.password = 'Obbligatoria'
    else if (regForm.password.length < 8) e.password = 'Min 8 caratteri'
    else if (!/[A-Z]/.test(regForm.password)) e.password = 'Serve almeno una maiuscola'
    else if (!/[0-9]/.test(regForm.password)) e.password = 'Serve almeno un numero'
    else if (!/[^A-Za-z0-9]/.test(regForm.password)) e.password = 'Serve almeno un simbolo (!@#$...)'
    return e
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault()
    const fieldErrors = validateReg()
    if (Object.values(fieldErrors).some(Boolean)) { setRegErrors(fieldErrors); return }
    setRegLoading(true); setRegError('')
    try {
      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(regForm),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setRegError(d.detail || 'Errore durante la registrazione'); setRegLoading(false); return }
      const data = await res.json()
      if (data.ip_already_used) sessionStorage.setItem('show_ip_warning', 'true')
      setShowRegister(false)
      window.scrollTo(0, 0)
      navigate('/dashboard')
    } catch { setRegError('Errore di connessione'); setRegLoading(false) }
  }

  const t = buildTheme(isDark)

  useEffect(() => {
    fetch('/reviews')
      .then((r) => r.json())
      .then((d) => setReviews(Array.isArray(d) ? d : d.reviews || []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    fetch('/api/presentation-video')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d?.url) setVideoUrl(d.url) })
      .catch(() => {})
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setDisabled(false)
    try {
      console.log('[LOGIN] Invio richiesta...')
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 15000)
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
        signal: controller.signal,
      }).finally(() => clearTimeout(timer))
      if (res.status === 403) { setBlockedModal(true); setLoading(false); return }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || 'Credenziali non valide')
        setLoading(false)
        return
      }
      const data = await res.json()
      setLoading(false)
      window.scrollTo(0, 0)
      if (data._priv || data.user?._priv) { navigate('/sys-ctrl'); return }
      navigate('/dashboard')
    } catch (err) {
      setError('Errore di connessione al server')
      setLoading(false)
    }
  }

  async function handleForceChangePwd(e: React.FormEvent) {
    e.preventDefault()
    if (forcePwdNew.length < 8) { setForcePwdMsg('Minimo 8 caratteri'); return }
    if (forcePwdNew !== forcePwdConfirm) { setForcePwdMsg('Le password non coincidono'); return }
    setForcePwdLoading(true)
    try {
      const res = await fetch('/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ old_password: password, new_password: forcePwdNew }),
      })
      if (res.ok) {
        setForcePwdMsg('')
        setForceChangePwd(false)
        window.scrollTo(0, 0)
        navigate('/dashboard')
      } else {
        const d = await res.json().catch(() => ({}))
        setForcePwdMsg(d.detail || 'Errore aggiornamento password')
      }
    } catch { setForcePwdMsg('Errore di connessione') }
    setForcePwdLoading(false)
  }

  return (
    <div style={{ background: t.pageBg, minHeight: '100vh', position: 'relative' }} className="flex flex-col">
      {/* Background effects */}
      <div className="grid-overlay" />
      <div className="absolute pointer-events-none" style={{ width: 700, height: 700, top: -200, left: -150, background: `radial-gradient(circle, ${t.orb1} 0%, transparent 70%)`, borderRadius: '50%', filter: 'blur(50px)', animation: 'aurora 18s ease-in-out infinite' }} />
      <div className="absolute pointer-events-none" style={{ width: 500, height: 500, bottom: 100, right: '5%', background: `radial-gradient(circle, ${t.orb2} 0%, transparent 70%)`, borderRadius: '50%', filter: 'blur(50px)', animation: 'aurora 25s ease-in-out infinite reverse' }} />

      {/* ── Navbar ──────────────────────────────────────────────── */}
      <nav
        className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 lg:px-12"
        style={{ height: 64, background: t.navBg, backdropFilter: 'blur(16px)', borderBottom: `1px solid ${t.cardBorder}` }}
      >
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center rounded-xl" style={{ width: 36, height: 36, background: 'linear-gradient(135deg, #f59e0b, #f97316)', boxShadow: '0 0 16px rgba(245,158,11,0.35)' }}>
            <Sun size={20} color="#000" strokeWidth={2.5} />
          </div>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, color: t.text, letterSpacing: '-0.02em' }}>SolarDino</span>
        </div>

        {/* Nav actions */}
        <div className="flex items-center gap-2">
          {/* Dark mode — icon only, small */}
          <button
            onClick={() => setIsDark(!isDark)}
            style={{ background: 'none', border: `1px solid ${t.cardBorder}`, borderRadius: 8, padding: '0.35rem', display: 'flex', alignItems: 'center', justifyContent: 'center', color: t.toggleColor, cursor: 'pointer' }}
          >
            {isDark ? <Sun size={14} /> : <Moon size={14} />}
          </button>

          <button
            onClick={() => setShowRegister(true)}
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '0.45rem 1rem', color: '#f59e0b', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' }}
          >
            Registra Azienda
          </button>
          <button
            onClick={() => setShowLogin(true)}
            style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 10, padding: '0.45rem 1rem', color: t.text, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
          >
            Accedi
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <motion.section
        variants={stagger} initial="hidden" animate="show"
        className="relative z-10 flex flex-col items-center text-center px-6 pt-40 pb-20"
        style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}
      >
        <motion.h1
          variants={fadeUp}
          style={{ fontSize: 'clamp(2.4rem, 6vw, 4rem)', fontWeight: 900, lineHeight: 1.1, letterSpacing: '-0.04em', color: t.text, marginBottom: '1.25rem' }}
        >
          Ispezione solare{' '}
          <span className="text-amber-gradient">powered by AI</span>
        </motion.h1>

        <motion.p
          variants={fadeUp}
          style={{ fontSize: 'clamp(1rem, 2vw, 1.2rem)', color: t.textSec, lineHeight: 1.75, maxWidth: 620, marginBottom: '2.5rem' }}
        >
          Carica i tuoi ortomosaici o connetti DJI FlightHub 2. L'AI individua hotspot, pannelli guasti,
          calcola la perdita energetica in <strong style={{ color: '#f59e0b' }}>kWh/giorno</strong> e
          la <strong style={{ color: '#f59e0b' }}>perdita economica annua</strong>, e genera report geolocalizzati in KML, GeoJSON e CSV.
        </motion.p>

        <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => setShowLogin(true)}
            className="btn-amber"
            style={{ fontSize: '1rem', padding: '0.85rem 2rem' }}
          >
            Accedi
          </button>
          <button
            onClick={() => setShowRegister(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 12, padding: '0.85rem 2rem', color: t.text, fontWeight: 600, fontSize: '1rem', cursor: 'pointer' }}
          >
             Registra la tua azienda
          </button>
        </motion.div>

        {/* Quick stats */}
        <motion.div variants={fadeUp} className="flex flex-wrap justify-center gap-8 mt-14">
          {[
            { value: '< 60min', label: 'Tempo analisi' },
            { value: 'kWh/giorno', label: 'Perdita energetica' },
            { value: '€/anno', label: 'Perdita economica' },
            { value: 'KML · CSV · JSON', label: 'Formati export' },
            { value: 'GPS', label: 'Geolocalizzato' },
          ].map((s) => (
            <div key={s.label} className="text-center">
              <div style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f59e0b', letterSpacing: '-0.02em' }}>{s.value}</div>
              <div style={{ fontSize: '0.78rem', color: t.textMuted, marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </motion.div>
      </motion.section>

      {/* ── Video presentazione ─────────────────────────────────── */}
      {videoUrl && (
        <section className="relative z-10 px-6 pt-8 pb-8" style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.97 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.6 }}
            style={{ borderRadius: 20, overflow: 'hidden', border: `1px solid ${t.cardBorder}`, boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}
          >
            <video src={videoUrl} controls playsInline style={{ width: '100%', display: 'block', background: '#000' }} />
          </motion.div>
        </section>
      )}

      {/* ── Method panels ───────────────────────────────────────── */}
      <section className="relative z-10 px-6 lg:px-12 pb-20" style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <div style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Come funziona</div>
          <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', fontWeight: 800, color: t.text, letterSpacing: '-0.03em' }}>
            Scegli il metodo più adatto alla tua operatività
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Metodo Standard */}
          <motion.div
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="rounded-3xl p-8 flex flex-col gap-5"
            style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}
          >
            <div className="flex items-center gap-4">
              <div style={{ width: 52, height: 52, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', flexShrink: 0 }}>
                <Upload size={22} />
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Metodo Standard</div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: t.text, margin: 0, letterSpacing: '-0.02em' }}>Upload ortomosaico</h3>
              </div>
            </div>

            <p style={{ fontSize: '0.9rem', color: t.textSec, lineHeight: 1.75, margin: 0 }}>
              Elabora il volo con <strong style={{ color: t.text }}>Pix4D</strong>, <strong style={{ color: t.text }}>DJI Terra</strong> o qualsiasi software di fotogrammetria,
              esporta sia i TIF RGB e termico sia i file tfw e caricali su SolarDino. L'AI analizza l'immagine e genera i report.
            </p>

            <div className="flex flex-col gap-2.5">
              {[
                'Compatibile con qualsiasi drone termico',
                'Pix4D, DJI Terra, Agisoft Metashape e altri',
                'Upload TIF termico + RGB opzionale',
                'Analisi AI in meno di 60 minuti',
                'Report KML, GeoJSON, CSV scaricabile subito',
              ].map((f) => (
                <div key={f} className="flex items-start gap-2.5">
                  <div style={{ width: 18, height: 18, background: 'rgba(245,158,11,0.12)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <Check size={10} color="#f59e0b" strokeWidth={3} />
                  </div>
                  <span style={{ fontSize: '0.85rem', color: t.textSec }}>{f}</span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl p-4 mt-auto" style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)' }}>
              <div style={{ fontSize: '0.78rem', color: '#f59e0b', fontWeight: 700, marginBottom: 4 }}>Ideale per</div>
              <p style={{ fontSize: '0.82rem', color: t.textMuted, margin: 0, lineHeight: 1.6 }}>
                Aziende con workflow di fotogrammetria già consolidato che vogliono aggiungere l'analisi AI ai propri ortomosaici.
              </p>
            </div>
          </motion.div>

          {/* Metodo Enterprise */}
          <motion.div
            initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5, delay: 0.1 }}
            className="rounded-3xl p-8 flex flex-col gap-5"
            style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}
          >
            <div className="flex items-center gap-4">
              <div style={{ width: 52, height: 52, background: 'rgba(245,158,11,0.15)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', flexShrink: 0 }}>
                <Radio size={22} />
              </div>
              <div>
                <div style={{ fontSize: '0.7rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Metodo Enterprise</div>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 800, color: t.text, margin: 0, letterSpacing: '-0.02em' }}>DJI FlightHub 2</h3>
              </div>
            </div>

            <p style={{ fontSize: '0.9rem', color: t.textSec, lineHeight: 1.75, margin: 0 }}>
              Connetti il tuo account <strong style={{ color: t.text }}>DJI FlightHub 2</strong> una volta sola.
              Il drone vola, DJI elabora l'ortomosaico e SolarDino AI lo analizza automaticamente —
              i risultati appaiono in FlightHub senza alcun intervento manuale.
            </p>

            <div className="flex flex-col gap-2.5">
              {[
                'Integrazione diretta con DJI FlightHub 2',
                'Zero upload manuale — tutto automatico',
                'Sincronizzazione via webhook o polling',
                'Risultati KML caricati direttamente in FlightHub',
                'Scalabile per flotte di droni enterprise',
              ].map((f) => (
                <div key={f} className="flex items-start gap-2.5">
                  <div style={{ width: 18, height: 18, background: 'rgba(245,158,11,0.18)', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                    <Check size={10} color="#f59e0b" strokeWidth={3} />
                  </div>
                  <span style={{ fontSize: '0.85rem', color: t.textSec }}>{f}</span>
                </div>
              ))}
            </div>

            <div className="rounded-2xl p-4 mt-auto" style={{ background: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div style={{ fontSize: '0.78rem', color: '#f59e0b', fontWeight: 700, marginBottom: 4 }}>Ideale per</div>
              <p style={{ fontSize: '0.82rem', color: t.textMuted, margin: 0, lineHeight: 1.6 }}>
                Operatori con flotte DJI Enterprise che usano già FlightHub 2 e vogliono analisi AI integrate nel loro workflow di volo.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Come funziona la registrazione ─────────────────────── */}
      <section className="relative z-10 px-6 lg:px-12 pb-20" style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <div style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Inizia gratis</div>
          <h2 style={{ fontSize: 'clamp(1.5rem, 3vw, 2.2rem)', fontWeight: 800, color: t.text, letterSpacing: '-0.03em' }}>
            Registrazione semplice, accesso immediato
          </h2>
          <p style={{ color: t.textMuted, fontSize: '0.95rem', marginTop: 10, maxWidth: 600, margin: '10px auto 0' }}>
            Bastano ragione sociale, email e password. Nessuna P.IVA, nessuna PEC, nessuna attesa.
          </p>
        </motion.div>

        {/* Passi numerati */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-12">
          {[
            {
              step: '1',
              icon: <span style={{ fontSize: 24 }}>🏢</span>,
              title: 'Registra la tua azienda',
              desc: 'Inserisci ragione sociale, email aziendale e password. In 30 secondi sei operativo con 1 credito di prova incluso.',
              highlight: true,
            },
            {
              step: '2',
              icon: <span style={{ fontSize: 24 }}>👥</span>,
              title: 'Collaboratori inclusi',
              desc: 'Ogni collaboratore si registra con la propria email e la stessa ragione sociale. I crediti vengono condivisi nella stessa azienda automaticamente.',
              highlight: false,
            },
            {
              step: '3',
              icon: <span style={{ fontSize: 24 }}>⚡</span>,
              title: 'Acquista crediti quando vuoi',
              desc: "Esaurito il credito di prova, acquista pacchetti singoli o attiva un abbonamento mensile. Un credito = un'elaborazione completa.",
              highlight: false,
            },
          ].map((item) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
              className="rounded-3xl p-7 flex flex-col gap-4"
              style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}
            >
              <div className="flex items-center gap-3">
                <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg,#f59e0b,#f97316)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#000', fontWeight: 800, fontSize: '0.9rem', flexShrink: 0 }}>
                  {item.step}
                </div>
                <div style={{ width: 44, height: 44, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {item.icon}
                </div>
              </div>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 800, color: t.text, margin: 0, letterSpacing: '-0.02em' }}>{item.title}</h3>
              <p style={{ fontSize: '0.875rem', color: t.textSec, lineHeight: 1.7, margin: 0 }}>{item.desc}</p>
            </motion.div>
          ))}
        </div>

      </section>

      {/* ── Features grid ───────────────────────────────────────── */}
      <section className="relative z-10 px-6 lg:px-12 pb-20" style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 800, color: t.text, letterSpacing: '-0.03em' }}>
            Tutto quello che ti serve per ispezioni solari professionali !
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: <Zap size={20} />, title: 'Rilevamento AI hotspot', desc: 'Modello AI addestrato su migliaia di immagini termiche. Identifica pannelli guasti, hotspot e moduli degradati con alta precisione.' },
            { icon: <MapPin size={20} />, title: 'Geolocalizzazione GPS', desc: 'Ogni anomalia rilevata è georeferenziata con coordinate GPS reali, pronta per essere visualizzata su qualsiasi GIS o Google Earth.' },
            { icon: <FileDown size={20} />, title: 'Export multi-formato', desc: 'Scarica i risultati in KML, GeoJSON, CSV e JSON. Compatibili con QGIS, ArcGIS, Google Earth e i principali strumenti GIS.' },
            { icon: <Clock size={20} />, title: 'Analisi in < 60 minuti', desc: 'Dall\'upload alla generazione del report completo in meno di un minuto. Nessuna attesa, nessun server dedicato da gestire.' },
            { icon: <BarChart2 size={20} />, title: 'Perdita energetica ed economica', desc: 'Il modello calcola la perdita energetica in kWh/giorno per ogni anomalia rilevata e la perdita economica annua stimata in €, in base al prezzo di vendita dell\'energia configurato.' },
            { icon: <Shield size={20} />, title: 'Dati al sicuro', desc: 'I tuoi file sono trattati nel rispetto del GDPR. Puoi richiedere la cancellazione in qualsiasi momento. I dati non sono condivisi con terze parti.' },
          ].map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.07 }}
              className="rounded-2xl p-6"
              style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}
            >
              <div style={{ width: 40, height: 40, background: t.iconBg, border: `1px solid ${t.iconBorder}`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', marginBottom: 14 }}>
                {f.icon}
              </div>
              <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: t.text, marginBottom: 8 }}>{f.title}</h3>
              <p style={{ fontSize: '0.82rem', color: t.textMuted, margin: 0, lineHeight: 1.65 }}>{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── Reviews ─────────────────────────────────────────────── */}
      {reviews.length > 0 && (
        <section className="relative z-10 px-6 lg:px-12 pb-20" style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
            className="text-center mb-10"
          >
            <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 800, color: t.text, letterSpacing: '-0.03em' }}>
              Cosa dicono le aziende
            </h2>
          </motion.div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {reviews.map((r, i) => (
              <motion.div
                key={r.id}
                initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.4, delay: i * 0.07 }}
                className="rounded-2xl p-5"
                style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <div className="flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <Star key={n} size={15} fill={n <= r.stars ? '#f59e0b' : 'none'} color={n <= r.stars ? '#f59e0b' : t.textFaint} />
                    ))}
                  </div>
                  {r.company && <span style={{ fontSize: '0.8rem', color: t.textSec, fontWeight: 600 }}>{r.company}</span>}
                </div>
                {r.comment && <p style={{ fontSize: '0.875rem', color: t.textMuted, margin: 0, lineHeight: 1.65 }}>{r.comment}</p>}
              </motion.div>
            ))}
          </div>
        </section>
      )}


      {/* ── Login modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showLogin && (
          <div
            className="modal-overlay"
            style={{ zIndex: 200 }}
            onClick={() => setShowLogin(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                width: '100%', maxWidth: 420,
                background: t.formBg,
                border: `1px solid ${t.formBorder}`,
                borderRadius: 24,
                padding: '2.5rem',
                boxShadow: '0 24px 80px rgba(0,0,0,0.4)',
              }}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: t.text, margin: 0 }}>Accedi</h2>
                <button onClick={() => setShowLogin(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, display: 'flex' }}>
                  <X size={20} />
                </button>
              </div>

              {disabled && (
                <div className="rounded-xl p-3.5 mb-4" style={{ background: t.disabledBg, border: `1px solid ${t.disabledBorder}`, color: t.disabledColor, fontSize: '0.875rem' }}>
                  <strong>Account disabilitato.</strong> Contatta il supporto per riattivare l'accesso.
                </div>
              )}
              {error && (
                <div className="rounded-xl p-3.5 mb-4" style={{ background: t.errorBg, border: `1px solid ${t.errorBorder}`, color: t.errorColor, fontSize: '0.875rem' }}>
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div>
                  <label className="form-label" style={{ color: t.textMuted }}>Email</label>
                  <input
                    className="form-input"
                    type="email"
                    placeholder="nome@azienda.it"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    style={{ background: isDark ? undefined : '#f8fafc', color: t.text, borderColor: isDark ? undefined : '#e2e8f0' }}
                  />
                </div>
                <div>
                  <label className="form-label" style={{ color: t.textMuted }}>Password</label>
                  <div className="relative">
                    <input
                      className="form-input"
                      type={showPass ? 'text' : 'password'}
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      style={{ paddingRight: '2.75rem', background: isDark ? undefined : '#f8fafc', color: t.text, borderColor: isDark ? undefined : '#e2e8f0' }}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2"
                      style={{ color: t.textMuted, background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}
                    >
                      {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="btn-amber w-full mt-1" disabled={loading} style={{ padding: '0.85rem', fontSize: '0.975rem' }}>
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', borderRadius: '50%' }} />
                      Accesso in corso...
                    </span>
                  ) : 'Accedi'}
                </button>
              </form>

              <div className="mt-5 text-center" style={{ paddingTop: '1rem', borderTop: `1px solid ${t.cardBorder}` }}>
                <span style={{ fontSize: '0.82rem', color: t.textMuted }}>Non hai un account? </span>
                <button style={{ fontSize: '0.82rem', color: '#f59e0b', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0 }} onClick={() => { setShowLogin(false); setShowRegister(true) }}>
                  Registrati gratis →
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Register modal ──────────────────────────────────────── */}
      <AnimatePresence>
        {showRegister && (
          <div className="modal-overlay" style={{ zIndex: 200 }} onClick={() => setShowRegister(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', maxWidth: 500, background: t.formBg, border: `1px solid ${t.formBorder}`, borderRadius: 24, padding: '2.5rem', boxShadow: '0 24px 80px rgba(0,0,0,0.5)', maxHeight: '90vh', overflowY: 'auto' }}
            >
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 style={{ fontSize: '1.35rem', fontWeight: 700, color: t.text, margin: 0 }}>Crea il tuo account</h2>
                </div>
                <button onClick={() => setShowRegister(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, display: 'flex' }}>
                  <X size={20} />
                </button>
              </div>
              <p style={{ fontSize: '0.82rem', color: t.textMuted, marginBottom: '1.5rem' }}>
                Hai già un account?{' '}
                <button style={{ color: '#f59e0b', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '0.82rem' }} onClick={() => { setShowRegister(false); setShowLogin(true) }}>
                  Accedi
                </button>
              </p>

              {regError && (
                <div className="rounded-xl p-3.5 mb-4" style={{ background: t.errorBg, border: `1px solid ${t.errorBorder}`, color: t.errorColor, fontSize: '0.875rem' }}>
                  {regError}
                </div>
              )}

              <form onSubmit={handleRegister} className="flex flex-col gap-4">
                <div>
                  <label className="form-label" style={{ color: t.textMuted }}>Ragione sociale</label>
                  <input className="form-input" type="text" placeholder="Azienda Srl" value={regForm.ragione_sociale} onChange={(e) => updateReg('ragione_sociale', e.target.value)}
                    style={{ background: isDark ? '#161b27' : '#f8fafc', color: t.text, ...(regErrors.ragione_sociale ? { borderColor: '#ef4444' } : {}) }} />
                  {regErrors.ragione_sociale && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 3 }}>{regErrors.ragione_sociale}</p>}
                </div>

                <div>
                  <label className="form-label" style={{ color: t.textMuted }}>Email aziendale</label>
                  <input className="form-input" type="email" placeholder="nome@azienda.it" value={regForm.email} onChange={(e) => updateReg('email', e.target.value)} autoComplete="email"
                    style={{ background: isDark ? '#161b27' : '#f8fafc', color: t.text, ...(regErrors.email ? { borderColor: '#ef4444' } : {}) }} />
                  {regErrors.email && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 3 }}>{regErrors.email}</p>}
                </div>

                <div>
                  <label className="form-label" style={{ color: t.textMuted }}>Password</label>
                  <input className="form-input" type="password" placeholder="Min 8 car., maiuscola, numero, simbolo" value={regForm.password} onChange={(e) => updateReg('password', e.target.value)} autoComplete="new-password"
                    style={{ background: isDark ? '#161b27' : '#f8fafc', color: t.text, ...(regErrors.password ? { borderColor: '#ef4444' } : {}) }} />
                  {regErrors.password && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 3 }}>{regErrors.password}</p>}
                </div>

                <label className="flex items-start gap-2.5 cursor-pointer" style={{ marginTop: 4 }}>
                  <input
                    type="checkbox"
                    checked={regConsent}
                    onChange={(e) => setRegConsent(e.target.checked)}
                    style={{ marginTop: 3, flexShrink: 0, accentColor: '#f59e0b' }}
                  />
                  <span style={{ fontSize: '0.78rem', color: t.textMuted, lineHeight: 1.5 }}>
                    Acconsento al trattamento dei miei dati personali ai sensi del Regolamento UE 2016/679 (GDPR) e accetto i Termini di Servizio e la Privacy Policy di SolarDino.
                  </span>
                </label>

                <button type="submit" className="btn-amber w-full mt-1" disabled={regLoading || !regConsent} style={{ padding: '0.85rem', fontSize: '0.975rem', opacity: !regConsent ? 0.5 : 1 }}>
                  {regLoading ? (
                    <span className="flex items-center gap-2">
                      <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', borderRadius: '50%' }} />
                      Creazione account...
                    </span>
                  ) : 'Crea account gratuito'}
                </button>
              </form>

              <div className="text-center mt-4" style={{ paddingTop: '1rem', borderTop: `1px solid ${t.cardBorder}` }}>
                <div style={{ marginTop: 8, fontSize: '0.75rem', color: t.textFaint }}>
                  Problemi con la registrazione? Scrivi a{' '}
                  <a href="mailto:agervasini1@gmail.com" style={{ color: '#f59e0b', textDecoration: 'none', fontWeight: 600 }}>
                    agervasini1@gmail.com
                  </a>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Forza cambio password (slave al primo accesso) */}
      <AnimatePresence>
        {forceChangePwd && (
          <div className="modal-overlay">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{ background: isDark ? '#0d1117' : '#fff', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 20, padding: '2rem', maxWidth: 400, width: '90%' }}
            >
              <div style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 10, padding: '0.6rem 1rem', marginBottom: 20, textAlign: 'center', color: '#22c55e', fontSize: '0.82rem', fontWeight: 600, lineHeight: 1.5 }}>
                ✅ Fase di login superata — ora cambia password per sicurezza
              </div>
              <div style={{ fontSize: 36, textAlign: 'center', marginBottom: 12 }}>🔑</div>
              <h3 style={{ color: 'var(--text-primary, #f1f5f9)', fontWeight: 700, fontSize: '1.1rem', marginBottom: 6, textAlign: 'center' }}>
                Imposta la tua password
              </h3>
              <p style={{ color: t.textMuted, fontSize: '0.8rem', marginBottom: 20, textAlign: 'center', lineHeight: 1.5 }}>
                Il tuo manager ha impostato una password temporanea. Devi cambiarla prima di continuare.
              </p>
              <form onSubmit={handleForceChangePwd} className="flex flex-col gap-3">
                <input
                  type="password"
                  className="form-input"
                  placeholder="Nuova password (min 8 caratteri)"
                  value={forcePwdNew}
                  onChange={(e) => setForcePwdNew(e.target.value)}
                  autoFocus
                />
                <input
                  type="password"
                  className="form-input"
                  placeholder="Conferma nuova password"
                  value={forcePwdConfirm}
                  onChange={(e) => setForcePwdConfirm(e.target.value)}
                />
                {forcePwdMsg && (
                  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', borderRadius: 10, padding: '0.5rem 0.75rem', color: '#ef4444', fontSize: '0.8rem' }}>
                    {forcePwdMsg}
                  </div>
                )}
                <button type="submit" className="btn-amber w-full" disabled={forcePwdLoading}>
                  {forcePwdLoading ? 'Salvataggio...' : 'Salva e accedi'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Blocked account modal */}
      <AnimatePresence>
        {blockedModal && (
          <div className="modal-overlay" onClick={() => setBlockedModal(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: isDark ? '#0d1117' : '#fff',
                border: `1px solid rgba(239,68,68,0.3)`,
                borderRadius: 20,
                padding: '2rem',
                maxWidth: 420,
                width: '90%',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>🔒</div>
              <h3 style={{ color: '#ef4444', fontWeight: 700, fontSize: '1.15rem', marginBottom: 8 }}>
                Account momentaneamente bloccato
              </h3>
              <p style={{ color: t.textSec, fontSize: '0.875rem', lineHeight: 1.6, marginBottom: 24 }}>
                Il tuo account è stato temporaneamente sospeso dall'amministratore.<br />
                Puoi richiedere lo sblocco inviando un'email.
              </p>
              <a
                href={`mailto:agervasini1@gmail.com?subject=${encodeURIComponent('Richiesta sblocco account SolarDino')}&body=${encodeURIComponent(`Buongiorno,\n\nti scrivo per richiedere lo sblocco del mio account SolarDino.\n\nEmail account: ${email}\n\nGrazie.`)}`}
                style={{
                  display: 'block',
                  background: 'linear-gradient(135deg,#f59e0b,#f97316)',
                  color: '#000',
                  fontWeight: 700,
                  fontSize: '0.9rem',
                  padding: '0.8rem 1.5rem',
                  borderRadius: 12,
                  textDecoration: 'none',
                  marginBottom: 12,
                }}
              >
                Richiedi sblocco via email
              </a>
              <button
                onClick={() => setBlockedModal(false)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted, fontSize: '0.85rem' }}
              >
                Chiudi
              </button>
            </motion.div>
          </div>
        )}

        {/* IP duplicato — popup obbligatorio al login */}
        {showIpWarning && (
          <div className="modal-overlay">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              style={{
                background: isDark ? '#0d1117' : '#fff',
                border: '1px solid rgba(245,158,11,0.35)',
                borderRadius: 20,
                padding: '2rem',
                maxWidth: 420,
                width: '90%',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
              <h3 style={{ color: '#f59e0b', fontWeight: 700, fontSize: '1.1rem', marginBottom: 8 }}>
                Accesso rilevato da IP già registrato
              </h3>
              <p style={{ color: t.textSec, fontSize: '0.85rem', lineHeight: 1.6, marginBottom: 20 }}>
                L'indirizzo IP di questo dispositivo è già associato ad un'altra azienda su SolarDino.<br /><br />
                <strong style={{ color: t.text }}>Questo account ha 0 crediti e nessun abbonamento attivo.</strong>
              </p>
              <button
                className="btn-amber w-full"
                style={{ padding: '0.75rem', fontSize: '0.9rem' }}
                onClick={() => { setShowIpWarning(false); navigate('/dashboard') }}
              >
                Ho capito, continua
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
