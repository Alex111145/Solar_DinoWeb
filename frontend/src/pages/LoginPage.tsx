import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, Zap, MapPin, FileDown, Eye, EyeOff, Star, Moon,
  Upload, Radio, Check, X, Shield, Clock, BarChart2, Gift,
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
  const [reviews, setReviews] = useState<Review[]>([])
  const [isDark, setIsDark] = useState(true)
  const [showLogin, setShowLogin] = useState(false)
  const [showRegister, setShowRegister] = useState(false)

  // Register form state
  const [regForm, setRegForm] = useState({ ragione_sociale: '', name: '', vat_number: '', email: '', password: '' })
  const [regLoading, setRegLoading] = useState(false)
  const [regError, setRegError] = useState('')
  const [regErrors, setRegErrors] = useState<Record<string, string>>({})

  function updateReg(k: string, v: string) {
    setRegForm((f) => ({ ...f, [k]: v }))
    if (regErrors[k]) setRegErrors((e) => ({ ...e, [k]: '' }))
  }

  function validateReg(): Record<string, string> {
    const e: Record<string, string> = {}
    if (!regForm.ragione_sociale.trim()) e.ragione_sociale = 'Campo obbligatorio'
    else if (!/\b(srl|s\.r\.l|spa|s\.p\.a|snc|s\.n\.c|sas|s\.a\.s|srls|ss|soc\.)\b/i.test(regForm.ragione_sociale)) e.ragione_sociale = 'Inserire la forma giuridica (es. Srl, Spa, Snc...)'
    const parts = regForm.name.trim().split(/\s+/)
    if (!regForm.name.trim()) e.name = 'Campo obbligatorio'
    else if (parts.length < 2 || parts[0].length < 2 || parts[parts.length - 1].length < 2) e.name = 'Inserire nome e cognome'
    if (!regForm.vat_number.trim()) e.vat_number = 'Obbligatoria'
    else if (/^it/i.test(regForm.vat_number.trim())) e.vat_number = 'Solo 11 cifre, senza IT'
    else if (!/^\d{11}$/.test(regForm.vat_number.trim())) e.vat_number = 'Esattamente 11 cifre'
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
        body: JSON.stringify(regForm),
      })
      if (!res.ok) { const d = await res.json().catch(() => ({})); setRegError(d.detail || 'Errore durante la registrazione'); setRegLoading(false); return }
      const data = await res.json()
      localStorage.setItem('token', data.access_token || data.token || '')
      localStorage.setItem('name', data.name || regForm.name)
      localStorage.setItem('email', data.email || regForm.email)
      localStorage.setItem('credits', String(data.credits ?? 2))
      localStorage.setItem('is_admin', 'false')
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setDisabled(false)
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (res.status === 403) { setDisabled(true); setLoading(false); return }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || 'Credenziali non valide')
        setLoading(false)
        return
      }
      const data = await res.json()
      localStorage.setItem('token', data.access_token || data.token || '')
      localStorage.setItem('name', data.name || data.user?.name || '')
      localStorage.setItem('email', data.email || data.user?.email || email)
      localStorage.setItem('credits', String(data.credits ?? data.user?.credits ?? 0))
      localStorage.setItem('is_admin', String(data.is_admin ?? data.user?.is_admin ?? false))
      if (data.is_admin || data.user?.is_admin) navigate('/admin')
      else navigate('/dashboard')
    } catch {
      setError('Errore di connessione al server')
      setLoading(false)
    }
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
            onClick={() => setShowLogin(true)}
            style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 10, padding: '0.45rem 1rem', color: t.text, fontWeight: 600, fontSize: '0.85rem', cursor: 'pointer' }}
          >
            Accedi
          </button>

          <button
            onClick={() => setShowRegister(true)}
            style={{ background: 'linear-gradient(135deg, #f59e0b, #f97316)', borderRadius: 10, padding: '0.45rem 1rem', color: '#000', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', boxShadow: '0 0 14px rgba(245,158,11,0.3)', border: 'none' }}
          >
            Registrati gratis
          </button>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────── */}
      <motion.section
        variants={stagger} initial="hidden" animate="show"
        className="relative z-10 flex flex-col items-center text-center px-6 pt-40 pb-20"
        style={{ maxWidth: 900, margin: '0 auto', width: '100%' }}
      >
        <motion.div variants={fadeUp} className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 mb-6" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', fontSize: '0.78rem', color: '#f59e0b', fontWeight: 600 }}>
          <Zap size={12} /> AI per ispezione fotovoltaica
        </motion.div>

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
          Carica un ortomosaico termico o connetti DJI FlightHub 2. L'AI individua hotspot, pannelli guasti
          e degradati e genera report geolocalizzati in KML, GeoJSON e CSV — in pochi secondi.
        </motion.p>

        <motion.div variants={fadeUp} className="flex flex-wrap items-center justify-center gap-3">
          <button
            onClick={() => setShowLogin(true)}
            className="btn-amber"
            style={{ fontSize: '1rem', padding: '0.85rem 2rem' }}
          >
            <Zap size={17} /> Inizia ora
          </button>
          <button
            onClick={() => setShowRegister(true)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 12, padding: '0.85rem 2rem', color: t.text, fontWeight: 600, fontSize: '1rem', cursor: 'pointer' }}
          >
            🎁 2 elaborazioni gratuite
          </button>
        </motion.div>

        {/* Quick stats */}
        <motion.div variants={fadeUp} className="flex flex-wrap justify-center gap-8 mt-14">
          {[
            { value: '< 60s', label: 'Tempo analisi' },
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
              esporta il TIF termico e caricalo su SolarDino. L'AI analizza l'immagine e genera i report in pochi secondi.
            </p>

            <div className="flex flex-col gap-2.5">
              {[
                'Compatibile con qualsiasi drone termico',
                'Pix4D, DJI Terra, Agisoft Metashape e altri',
                'Upload TIF termico + RGB opzionale',
                'Analisi AI in meno di 60 secondi',
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
            style={{ background: 'rgba(245,158,11,0.04)', border: '1.5px solid rgba(245,158,11,0.2)' }}
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

      {/* ── Features grid ───────────────────────────────────────── */}
      <section className="relative z-10 px-6 lg:px-12 pb-20" style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="text-center mb-10"
        >
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 800, color: t.text, letterSpacing: '-0.03em' }}>
            Tutto quello che ti serve per ispezioni solari professionali
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { icon: <Zap size={20} />, title: 'Rilevamento AI hotspot', desc: 'Modello AI addestrato su migliaia di immagini termiche. Identifica pannelli guasti, hotspot e moduli degradati con alta precisione.' },
            { icon: <MapPin size={20} />, title: 'Geolocalizzazione GPS', desc: 'Ogni anomalia rilevata è georeferenziata con coordinate GPS reali, pronta per essere visualizzata su qualsiasi GIS o Google Earth.' },
            { icon: <FileDown size={20} />, title: 'Export multi-formato', desc: 'Scarica i risultati in KML, GeoJSON, CSV e JSON. Compatibili con QGIS, ArcGIS, Google Earth e i principali strumenti GIS.' },
            { icon: <Clock size={20} />, title: 'Analisi in < 60 secondi', desc: 'Dall\'upload alla generazione del report completo in meno di un minuto. Nessuna attesa, nessun server dedicato da gestire.' },
            { icon: <BarChart2 size={20} />, title: 'Calcolo perdita potenza', desc: 'Inserendo efficienza nominale e coefficiente di temperatura, il report include la stima della perdita di potenza e l\'impatto economico annuo.' },
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
              Cosa dicono i clienti
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

      {/* ── Footer CTA ──────────────────────────────────────────── */}
      <section className="relative z-10 px-6 lg:px-12 pb-20" style={{ maxWidth: 1280, margin: '0 auto', width: '100%' }}>
        <motion.div
          initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.5 }}
          className="rounded-3xl p-10 text-center"
          style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)' }}
        >
          <h2 style={{ fontSize: 'clamp(1.4rem, 3vw, 2rem)', fontWeight: 800, color: t.text, marginBottom: 12, letterSpacing: '-0.03em' }}>
            Inizia con 2 elaborazioni gratuite
          </h2>
          <p style={{ fontSize: '0.95rem', color: t.textSec, marginBottom: 24, lineHeight: 1.7 }}>
            Nessuna carta di credito richiesta. Registrati e prova subito l'analisi AI sui tuoi ortomosaici.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              onClick={() => setShowRegister(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'linear-gradient(135deg, #f59e0b, #f97316)', borderRadius: 12, padding: '0.85rem 2rem', color: '#000', fontWeight: 700, fontSize: '1rem', cursor: 'pointer', boxShadow: '0 0 20px rgba(245,158,11,0.3)', border: 'none' }}
            >
              <Zap size={17} /> Registrati gratis
            </button>
            <button
              onClick={() => setShowLogin(true)}
              style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}`, borderRadius: 12, padding: '0.85rem 2rem', color: t.text, fontWeight: 600, fontSize: '1rem', cursor: 'pointer' }}
            >
              Ho già un account
            </button>
          </div>
        </motion.div>
      </section>

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
                  <div className="flex items-center gap-2 mb-1">
                    <Gift size={16} color="#f59e0b" />
                    <span style={{ fontSize: '0.78rem', color: '#f59e0b', fontWeight: 700 }}>2 elaborazioni gratuite</span>
                  </div>
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

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="form-label" style={{ color: t.textMuted }}>Nome referente</label>
                    <input className="form-input" type="text" placeholder="Mario Rossi" value={regForm.name} onChange={(e) => updateReg('name', e.target.value)}
                      style={{ background: isDark ? '#161b27' : '#f8fafc', color: t.text, ...(regErrors.name ? { borderColor: '#ef4444' } : {}) }} />
                    {regErrors.name && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 3 }}>{regErrors.name}</p>}
                  </div>
                  <div>
                    <label className="form-label" style={{ color: t.textMuted }}>Partita IVA</label>
                    <input className="form-input" type="text" placeholder="12345678901" value={regForm.vat_number} onChange={(e) => updateReg('vat_number', e.target.value)}
                      style={{ background: isDark ? '#161b27' : '#f8fafc', color: t.text, ...(regErrors.vat_number ? { borderColor: '#ef4444' } : {}) }} />
                    {regErrors.vat_number && <p style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: 3 }}>{regErrors.vat_number}</p>}
                  </div>
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

                <button type="submit" className="btn-amber w-full mt-1" disabled={regLoading} style={{ padding: '0.85rem', fontSize: '0.975rem' }}>
                  {regLoading ? (
                    <span className="flex items-center gap-2">
                      <motion.span animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }} style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', borderRadius: '50%' }} />
                      Creazione account...
                    </span>
                  ) : 'Crea account gratuito'}
                </button>

                <p style={{ fontSize: '0.75rem', color: t.textMuted, textAlign: 'center', marginTop: 2 }}>
                  Registrandoti accetti i Termini di Servizio e la Privacy Policy.
                </p>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
