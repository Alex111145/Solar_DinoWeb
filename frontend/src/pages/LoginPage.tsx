import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sun, Zap, MapPin, FileDown, Eye, EyeOff, Star, Moon } from 'lucide-react'

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
}
const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
}

const stats = [
  {
    icon: <Zap size={18} />,
    label: 'AI / MaskDINO',
    value: 'Rilevamento Hot Spot Pannelli',
    desc: 'Segmentazione semantica con modelli DINO',
    features: ['Analisi termografica automatizzata', 'Overlay RGB + Termico'],
  },
  {
    icon: <MapPin size={18} />,
    label: 'GPS / Geolocalizzato',
    value: 'Coordinate precise',
    desc: 'Ogni anomalia è geolocalizzata con coordinate GPS reali',
    features: ['Rilevamento hotspot pannelli'],
  },
  {
    icon: <FileDown size={18} />,
    label: 'KML / Export',
    value: 'Multi-formato',
    desc: 'Esporta in KML, JSON e CSV',
    features: ['Report scaricabile istantaneamente', 'Calcolo efficienza pannelli*'],
    note: '* Disponibile fornendo potenza nominale, efficienza e coefficiente di temperatura dei pannelli.',
  },
]

interface Review { id: string; company?: string; stars: number; comment?: string }

function buildTheme(dark: boolean) {
  return dark ? {
    pageBg: '#060912',
    text: '#f1f5f9',
    textSec: '#94a3b8',
    textMuted: '#64748b',
    textFaint: '#475569',
    cardBg: 'rgba(255,255,255,0.03)',
    cardBorder: 'rgba(255,255,255,0.07)',
    formBg: 'rgba(255,255,255,0.03)',
    formBorder: 'rgba(255,255,255,0.08)',
    toggleBg: 'rgba(255,255,255,0.08)',
    toggleColor: '#f59e0b',
    orb1: 'rgba(245,158,11,0.12)',
    orb2: 'rgba(249,115,22,0.09)',
    iconBg: 'rgba(245,158,11,0.12)',
    iconBorder: 'rgba(245,158,11,0.2)',
    dotColor: '#f59e0b',
    noteColor: '#475569',
    disabledBg: 'rgba(249,115,22,0.1)',
    disabledBorder: 'rgba(249,115,22,0.3)',
    disabledColor: '#f97316',
    errorBg: 'rgba(239,68,68,0.1)',
    errorBorder: 'rgba(239,68,68,0.3)',
    errorColor: '#ef4444',
    ctaBg: 'rgba(245,158,11,0.06)',
    ctaBorder: 'rgba(245,158,11,0.2)',
    ctaLinkBg: 'rgba(245,158,11,0.15)',
    ctaLinkBorder: 'rgba(245,158,11,0.4)',
  } : {
    pageBg: '#f1f5f9',
    text: '#1e293b',
    textSec: '#334155',
    textMuted: '#64748b',
    textFaint: '#94a3b8',
    cardBg: '#ffffff',
    cardBorder: '#e2e8f0',
    formBg: '#ffffff',
    formBorder: '#e2e8f0',
    toggleBg: '#ffffff',
    toggleColor: '#1e293b',
    orb1: 'rgba(245,158,11,0.08)',
    orb2: 'rgba(249,115,22,0.05)',
    iconBg: 'rgba(245,158,11,0.12)',
    iconBorder: 'rgba(245,158,11,0.2)',
    dotColor: '#f59e0b',
    noteColor: '#94a3b8',
    disabledBg: 'rgba(249,115,22,0.08)',
    disabledBorder: 'rgba(249,115,22,0.25)',
    disabledColor: '#f97316',
    errorBg: 'rgba(239,68,68,0.07)',
    errorBorder: 'rgba(239,68,68,0.25)',
    errorColor: '#dc2626',
    ctaBg: 'rgba(245,158,11,0.06)',
    ctaBorder: 'rgba(245,158,11,0.2)',
    ctaLinkBg: 'rgba(245,158,11,0.12)',
    ctaLinkBorder: 'rgba(245,158,11,0.35)',
  }
}

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
    <div
      style={{ background: t.pageBg, minHeight: '100vh', position: 'relative', overflow: 'hidden' }}
      className="flex flex-col lg:flex-row"
    >
      {/* Aurora orbs */}
      <div className="grid-overlay" />
      <div className="absolute pointer-events-none" style={{ width: '600px', height: '600px', top: '-150px', left: '-100px', background: `radial-gradient(circle, ${t.orb1} 0%, transparent 70%)`, borderRadius: '50%', filter: 'blur(40px)', animation: 'aurora 18s ease-in-out infinite' }} />
      <div className="absolute pointer-events-none" style={{ width: '500px', height: '500px', bottom: '-100px', right: '10%', background: `radial-gradient(circle, ${t.orb2} 0%, transparent 70%)`, borderRadius: '50%', filter: 'blur(50px)', animation: 'aurora 25s ease-in-out infinite reverse' }} />

      {/* Toggle dark/light mode */}
      <button
        onClick={() => setIsDark(!isDark)}
        style={{
          position: 'fixed', top: 16, right: 16, zIndex: 100,
          background: t.toggleBg, border: `1px solid ${t.cardBorder}`,
          borderRadius: 12, padding: '0.5rem 0.75rem',
          display: 'flex', alignItems: 'center', gap: 6,
          color: t.toggleColor, cursor: 'pointer',
          fontSize: '0.8rem', fontWeight: 600,
          backdropFilter: 'blur(12px)',
          boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        }}
      >
        {isDark ? <Sun size={15} /> : <Moon size={15} />}
        {isDark ? 'Modalità chiara' : 'Modalità scura'}
      </button>

      {/* ── Centered wrapper ──────────────────────────────────── */}
      <div className="flex flex-col lg:flex-row relative z-10 w-full flex-1" style={{ maxWidth: 1280, margin: '0 auto' }}>

      {/* ── Left panel ────────────────────────────────────────── */}
      <motion.div
        className="flex flex-col px-6 pt-14 pb-10 lg:px-12 xl:px-16 lg:justify-center"
        style={{ flex: 1, minWidth: 0 }}
        variants={container}
        initial="hidden"
        animate="show"
      >
        <div style={{ maxWidth: 520, width: '100%' }}>
          {/* Logo */}
          <motion.div variants={item} className="flex items-center gap-3 mb-10">
            <div className="flex items-center justify-center rounded-xl" style={{ width: 44, height: 44, background: 'linear-gradient(135deg, #f59e0b, #f97316)', boxShadow: '0 0 20px rgba(245,158,11,0.4)' }}>
              <Sun size={24} color="#000" strokeWidth={2.5} />
            </div>
            <span style={{ fontSize: '1.3rem', fontWeight: 700, color: t.text, letterSpacing: '-0.02em' }}>SolarDino</span>
          </motion.div>

          {/* Hero title */}
          <motion.h1
            variants={item}
            style={{ fontSize: 'clamp(1.8rem, 5vw, 2.8rem)', fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.03em', marginBottom: '1rem', color: t.text }}
          >
            Ispezione solare{' '}
            <span className="text-amber-gradient">powered by AI</span>
          </motion.h1>

          <motion.p variants={item} style={{ fontSize: '1rem', color: t.textSec, lineHeight: 1.7, marginBottom: '1.75rem', maxWidth: 460 }}>
            Carica i tuoi ortomosaici termici e RGB. L'intelligenza artificiale individua gli hotspot,
            mappa i pannelli difettosi e genera report esportabili in secondi.
          </motion.p>

          {/* Stat cards */}
          <motion.div variants={item} className="flex flex-col gap-3 mb-6" style={{ maxWidth: 460 }}>
            {stats.map((s) => (
              <div key={s.label} className="flex items-start gap-4 p-4 rounded-2xl" style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}>
                <div className="flex items-center justify-center rounded-lg flex-shrink-0 mt-0.5" style={{ width: 36, height: 36, background: t.iconBg, color: '#f59e0b', border: `1px solid ${t.iconBorder}` }}>
                  {s.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{s.label}</div>
                  <div style={{ fontSize: '0.925rem', color: t.text, fontWeight: 600 }}>{s.value}</div>
                  <div style={{ fontSize: '0.82rem', color: t.textMuted, marginTop: 2 }}>{s.desc}</div>
                  {'features' in s && s.features.length > 0 && (
                    <div className="flex flex-col gap-1 mt-2">
                      {s.features.map((f: string) => (
                        <div key={f} className="flex items-center gap-1.5" style={{ fontSize: '0.78rem', color: t.textSec }}>
                          <div style={{ width: 4, height: 4, borderRadius: '50%', background: t.dotColor, flexShrink: 0 }} />
                          {f}
                        </div>
                      ))}
                    </div>
                  )}
                  {'note' in s && <div style={{ fontSize: '0.71rem', color: t.noteColor, marginTop: 6, lineHeight: 1.5 }}>{s.note}</div>}
                </div>
              </div>
            ))}
          </motion.div>

          {/* Reviews */}
          {reviews.length > 0 && (
            <motion.div variants={item} style={{ maxWidth: 460 }}>
              <div style={{ fontSize: '0.72rem', color: t.textFaint, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                Cosa dicono i clienti
              </div>
              <div className="flex flex-col gap-2">
                {reviews.slice(0, 3).map((r) => (
                  <div key={r.id} className="rounded-2xl p-3.5" style={{ background: t.cardBg, border: `1px solid ${t.cardBorder}` }}>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="flex gap-0.5">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <Star key={n} size={12} fill={n <= r.stars ? '#f59e0b' : 'none'} color={n <= r.stars ? '#f59e0b' : t.textFaint} />
                        ))}
                      </div>
                      {r.company && <span style={{ fontSize: '0.75rem', color: t.textSec, fontWeight: 500 }}>{r.company}</span>}
                    </div>
                    {r.comment && <p style={{ fontSize: '0.8rem', color: t.textMuted, margin: 0, lineHeight: 1.5 }}>{r.comment}</p>}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </div>
      </motion.div>

      {/* ── Right panel — form ────────────────────────────────── */}
      <div className="flex items-start lg:items-center justify-start relative z-10 p-6 pb-14 lg:py-6 lg:pl-10 lg:pr-14" style={{ flex: '0 0 auto', width: '100%', maxWidth: 560 }}>
        <motion.div
          initial={{ opacity: 0, x: 0, y: 20 }}
          animate={{ opacity: 1, x: 0, y: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{
            width: '100%', maxWidth: 420,
            background: t.formBg,
            border: `1px solid ${t.formBorder}`,
            borderRadius: 24,
            padding: '2.5rem',
            boxShadow: isDark ? 'none' : '0 4px 32px rgba(0,0,0,0.08)',
          }}
        >
          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: t.text, marginBottom: '1.75rem' }}>Accedi</h2>

          {disabled && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl p-3.5 mb-4" style={{ background: t.disabledBg, border: `1px solid ${t.disabledBorder}`, color: t.disabledColor, fontSize: '0.875rem' }}>
              <strong>Account disabilitato.</strong> Contatta il supporto per riattivare l'accesso.
            </motion.div>
          )}

          {error && (
            <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl p-3.5 mb-4" style={{ background: t.errorBg, border: `1px solid ${t.errorBorder}`, color: t.errorColor, fontSize: '0.875rem' }}>
              {error}
            </motion.div>
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
                style={{ background: isDark ? undefined : '#f8fafc', color: t.text, borderColor: isDark ? undefined : t.cardBorder }}
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
                  style={{ paddingRight: '2.75rem', background: isDark ? undefined : '#f8fafc', color: t.text, borderColor: isDark ? undefined : t.cardBorder }}
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

          {/* Register CTA */}
          <div className="mt-5 rounded-2xl p-4 text-center" style={{ background: t.ctaBg, border: `1px solid ${t.ctaBorder}` }}>
            <div style={{ fontSize: '0.8rem', color: t.textMuted, marginBottom: 6 }}>Non hai ancora un account?</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f59e0b', marginBottom: 10, letterSpacing: '-0.01em' }}>🎁 2 Elaborazioni gratuite</div>
            <Link to="/register" style={{ display: 'block', background: t.ctaLinkBg, border: `1px solid ${t.ctaLinkBorder}`, borderRadius: 12, padding: '0.65rem 1rem', color: '#f59e0b', fontWeight: 700, fontSize: '0.9rem', textDecoration: 'none' }}>
              Registrati gratis →
            </Link>
          </div>
        </motion.div>
      </div>

      </div>{/* end centered wrapper */}
    </div>
  )
}
