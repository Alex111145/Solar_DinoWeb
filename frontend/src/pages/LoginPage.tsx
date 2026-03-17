import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sun, Zap, MapPin, FileDown, CheckCircle, Eye, EyeOff } from 'lucide-react'

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
}

const stats = [
  {
    icon: <Zap size={18} />,
    label: 'AI / MaskDINO',
    value: 'Rilevamento pannelli',
    desc: 'Segmentazione semantica con modelli DINO',
  },
  {
    icon: <MapPin size={18} />,
    label: 'GPS / Geolocalizzato',
    value: 'Coordinate precise',
    desc: 'Ogni anomalia con coordinate GPS reali',
  },
  {
    icon: <FileDown size={18} />,
    label: 'KML / Export',
    value: 'Multi-formato',
    desc: 'Esporta in KML, JSON e CSV',
  },
]

const features = [
  'Analisi termografica automatizzata',
  'Rilevamento hotspot pannelli',
  'Calcolo efficienza pannelli*',
  'Overlay RGB + Termico',
  'Report scaricabile istantaneamente',
]

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [disabled, setDisabled] = useState(false)

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
      if (res.status === 403) {
        setDisabled(true)
        setLoading(false)
        return
      }
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
      if (data.is_admin || data.user?.is_admin) {
        navigate('/admin')
      } else {
        navigate('/dashboard')
      }
    } catch {
      setError('Errore di connessione al server')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex" style={{ background: '#060912' }}>
      {/* Aurora orbs */}
      <div className="grid-overlay" />
      <div
        className="absolute pointer-events-none"
        style={{
          width: '600px',
          height: '600px',
          top: '-150px',
          left: '-100px',
          background: 'radial-gradient(circle, rgba(245,158,11,0.12) 0%, transparent 70%)',
          borderRadius: '50%',
          filter: 'blur(40px)',
          animation: 'aurora 18s ease-in-out infinite',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: '500px',
          height: '500px',
          bottom: '-100px',
          right: '10%',
          background: 'radial-gradient(circle, rgba(249,115,22,0.09) 0%, transparent 70%)',
          borderRadius: '50%',
          filter: 'blur(50px)',
          animation: 'aurora 25s ease-in-out infinite reverse',
        }}
      />

      {/* Left panel */}
      <motion.div
        className="hidden lg:flex flex-col justify-center px-14 xl:px-20 relative z-10"
        style={{ width: '52%', minHeight: '100vh' }}
        variants={container}
        initial="hidden"
        animate="show"
      >
        {/* Logo */}
        <motion.div variants={item} className="flex items-center gap-3 mb-12">
          <div
            className="flex items-center justify-center rounded-xl"
            style={{
              width: 44,
              height: 44,
              background: 'linear-gradient(135deg, #f59e0b, #f97316)',
              boxShadow: '0 0 20px rgba(245,158,11,0.4)',
            }}
          >
            <Sun size={24} color="#000" strokeWidth={2.5} />
          </div>
          <span style={{ fontSize: '1.3rem', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
            SolarDino
          </span>
        </motion.div>

        {/* Hero title */}
        <motion.h1
          variants={item}
          style={{
            fontSize: 'clamp(2rem, 3.5vw, 2.8rem)',
            fontWeight: 800,
            lineHeight: 1.15,
            letterSpacing: '-0.03em',
            marginBottom: '1.25rem',
            color: '#f1f5f9',
          }}
        >
          Ispezione solare{' '}
          <span className="text-amber-gradient">powered by AI</span>
        </motion.h1>

        <motion.p
          variants={item}
          style={{ fontSize: '1.05rem', color: '#94a3b8', lineHeight: 1.7, marginBottom: '2rem', maxWidth: 460 }}
        >
          Carica il tuo ortomosaico termico e RGB. L'intelligenza artificiale individua ogni anomalia,
          mappa i pannelli difettosi e genera report esportabili in secondi.
        </motion.p>

        {/* Stat cards */}
        <motion.div variants={item} className="flex flex-col gap-3 mb-8" style={{ maxWidth: 460 }}>
          {stats.map((s) => (
            <div
              key={s.label}
              className="flex items-start gap-4 p-4 rounded-2xl"
              style={{
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.07)',
              }}
            >
              <div
                className="flex items-center justify-center rounded-lg flex-shrink-0 mt-0.5"
                style={{
                  width: 36,
                  height: 36,
                  background: 'rgba(245,158,11,0.12)',
                  color: '#f59e0b',
                  border: '1px solid rgba(245,158,11,0.2)',
                }}
              >
                {s.icon}
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>
                  {s.label}
                </div>
                <div style={{ fontSize: '0.925rem', color: '#f1f5f9', fontWeight: 600 }}>{s.value}</div>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: 2 }}>{s.desc}</div>
              </div>
            </div>
          ))}
        </motion.div>

        {/* Feature list */}
        <motion.ul variants={item} className="flex flex-col gap-2.5">
          {features.map((f) => (
            <li key={f} className="flex items-center gap-3" style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
              <motion.span
                style={{ color: '#f59e0b', display: 'flex', flexShrink: 0 }}
                animate={{ opacity: [0.5, 1, 0.5] }}
                transition={{ duration: 2, repeat: Infinity, delay: Math.random() * 2 }}
              >
                <CheckCircle size={15} />
              </motion.span>
              {f}
            </li>
          ))}
        </motion.ul>
        <motion.p variants={item} style={{ fontSize: '0.75rem', color: '#475569', marginTop: '0.75rem', lineHeight: 1.6 }}>
          * Il calcolo dell'efficienza è disponibile solo se vengono forniti i valori nominali dei pannelli (potenza, efficienza, coefficiente di temperatura).
        </motion.p>
      </motion.div>

      {/* Right panel — form */}
      <div
        className="flex items-center justify-center relative z-10 p-6"
        style={{ flex: 1, minHeight: '100vh' }}
      >
        <motion.div
          initial={{ opacity: 0, x: 40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{
            width: '100%',
            maxWidth: 420,
            background: 'rgba(255,255,255,0.03)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 24,
            padding: '2.5rem',
          }}
        >
          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-2 mb-6 justify-center">
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 38, height: 38, background: 'linear-gradient(135deg, #f59e0b, #f97316)' }}
            >
              <Sun size={20} color="#000" strokeWidth={2.5} />
            </div>
            <span style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f1f5f9' }}>SolarDino</span>
          </div>

          <h2 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#f1f5f9', marginBottom: '1.75rem' }}>
            Accedi
          </h2>

          {/* Disabled banner */}
          {disabled && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl p-3.5 mb-4"
              style={{
                background: 'rgba(249,115,22,0.1)',
                border: '1px solid rgba(249,115,22,0.3)',
                color: '#f97316',
                fontSize: '0.875rem',
              }}
            >
              <strong>Account disabilitato.</strong> Contatta il supporto per riattivare l'accesso.
            </motion.div>
          )}

          {/* Error */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl p-3.5 mb-4"
              style={{
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.3)',
                color: '#ef4444',
                fontSize: '0.875rem',
              }}
            >
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="form-label">Email</label>
              <input
                className="form-input"
                type="email"
                placeholder="nome@azienda.it"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="form-label">Password</label>
              <div className="relative">
                <input
                  className="form-input"
                  type={showPass ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  autoComplete="current-password"
                  style={{ paddingRight: '2.75rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: '#64748b', background: 'none', border: 'none', cursor: 'pointer', display: 'flex' }}
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className="btn-amber w-full mt-1"
              disabled={loading}
              style={{ padding: '0.85rem', fontSize: '0.975rem' }}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <motion.span
                    animate={{ rotate: 360 }}
                    transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}
                    style={{ display: 'inline-block', width: 16, height: 16, border: '2px solid rgba(0,0,0,0.3)', borderTopColor: '#000', borderRadius: '50%' }}
                  />
                  Accesso in corso...
                </span>
              ) : (
                'Accedi'
              )}
            </button>
          </form>

          {/* Registrazione — sotto il bottone */}
          <div
            className="mt-5 rounded-2xl p-4 text-center"
            style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 6 }}>Non hai ancora un account?</div>
            <div style={{ fontSize: '1.15rem', fontWeight: 800, color: '#f59e0b', marginBottom: 10, letterSpacing: '-0.01em' }}>
              🎁 2 elaborazioni gratuite
            </div>
            <Link
              to="/register"
              style={{
                display: 'block',
                background: 'rgba(245,158,11,0.15)',
                border: '1px solid rgba(245,158,11,0.4)',
                borderRadius: 12,
                padding: '0.65rem 1rem',
                color: '#f59e0b',
                fontWeight: 700,
                fontSize: '0.9rem',
                textDecoration: 'none',
              }}
            >
              Registrati gratis →
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
