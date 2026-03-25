import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sun, ArrowLeft } from 'lucide-react'

const item = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5 } },
}

const container = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { staggerChildren: 0.08 } },
}

const LEGAL_FORM_RE = /\b(srl|s\.r\.l\.?|spa|s\.p\.a\.?|snc|s\.n\.c\.?|sas|s\.a\.s\.?|srls|s\.r\.l\.s\.?|ss|s\.s\.?|coop|scarl|onlus|ets|di|e\.i\.?)\b/i

export default function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    ragione_sociale: '',
    email: '',
    password: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  function update(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
    if (errors[k]) setErrors((e) => ({ ...e, [k]: '' }))
  }

  function validate(): Record<string, string> {
    const e: Record<string, string> = {}

    const rs = form.ragione_sociale.trim()
    if (!rs) {
      e.ragione_sociale = 'Campo obbligatorio'
    } else if (rs.length < 3) {
      e.ragione_sociale = 'Minimo 3 caratteri'
    } else if (rs.length > 150) {
      e.ragione_sociale = 'Massimo 150 caratteri'
    } else if (!LEGAL_FORM_RE.test(rs)) {
      e.ragione_sociale = 'Inserire la forma giuridica (es. Srl, Spa, Snc, Sas...)'
    }

    if (!form.email.trim()) {
      e.email = 'Email obbligatoria'
    } else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(form.email)) {
      e.email = 'Email non valida (es. nome@azienda.it)'
    }

    if (!form.password) {
      e.password = 'Password obbligatoria'
    } else if (form.password.length < 8) {
      e.password = 'Minimo 8 caratteri'
    } else if (!/[A-Z]/.test(form.password)) {
      e.password = 'Deve contenere almeno una lettera maiuscola'
    } else if (!/[0-9]/.test(form.password)) {
      e.password = 'Deve contenere almeno un numero'
    } else if (!/[^A-Za-z0-9]/.test(form.password)) {
      e.password = 'Deve contenere almeno un carattere speciale (!@#$...)'
    }

    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const fieldErrors = validate()
    if (Object.values(fieldErrors).some(Boolean)) {
      setErrors(fieldErrors)
      return
    }
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.detail || 'Errore durante la registrazione')
        setLoading(false)
        return
      }
      const data = await res.json()
      localStorage.setItem('token', data.access_token || data.token || '')
      localStorage.setItem('name', data.name || form.ragione_sociale)
      localStorage.setItem('email', data.email || form.email)
      localStorage.setItem('credits', String(data.credits ?? 0))
      localStorage.setItem('is_admin', String(data.is_admin ?? false))
      if (data.ip_already_used) localStorage.setItem('show_ip_warning', 'true')
      navigate('/dashboard')
    } catch {
      setError('Errore di connessione al server')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen relative overflow-hidden flex items-center justify-center p-6" style={{ background: '#060912' }}>
      <div className="grid-overlay" />

      {/* Back button — top left */}
      <div style={{ position: 'absolute', top: '1.25rem', left: '1.25rem', zIndex: 20 }}>
        <Link
          to="/login"
          className="flex items-center gap-2 btn-amber"
          style={{ fontSize: '0.975rem', fontWeight: 700, textDecoration: 'none', padding: '0.7rem 1.5rem', borderRadius: 12 }}
        >
          <ArrowLeft size={18} /> Torna al login
        </Link>
      </div>

      {/* Aurora orbs */}
      <div
        className="absolute pointer-events-none"
        style={{
          width: '700px', height: '700px', top: '-200px', right: '-100px',
          background: 'radial-gradient(circle, rgba(245,158,11,0.1) 0%, transparent 70%)',
          borderRadius: '50%', filter: 'blur(60px)', animation: 'aurora 22s ease-in-out infinite',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: '500px', height: '500px', bottom: '-100px', left: '5%',
          background: 'radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 70%)',
          borderRadius: '50%', filter: 'blur(50px)', animation: 'aurora 30s ease-in-out infinite reverse',
        }}
      />

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        style={{ width: '100%', maxWidth: 480, position: 'relative', zIndex: 10 }}
      >
        {/* Logo */}
        <motion.div variants={item} className="flex items-center justify-center gap-3 mb-6">
          <div
            className="flex items-center justify-center rounded-xl"
            style={{ width: 42, height: 42, background: 'linear-gradient(135deg, #f59e0b, #f97316)', boxShadow: '0 0 20px rgba(245,158,11,0.4)' }}
          >
            <Sun size={22} color="#000" strokeWidth={2.5} />
          </div>
          <span style={{ fontSize: '1.25rem', fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.02em' }}>
            SolarDino
          </span>
        </motion.div>

        {/* Card */}
        <motion.div variants={item} className="card" style={{ padding: '2.25rem', borderRadius: 24 }}>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
            Crea il tuo account
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1.75rem' }}>
            Hai già un account?{' '}
            <Link to="/login" style={{ color: '#f59e0b', fontWeight: 600 }}>Accedi</Link>
          </p>

          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl p-3.5 mb-4"
              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: '0.875rem' }}
            >
              {error}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="form-label">Ragione sociale</label>
              <input
                className="form-input"
                type="text"
                placeholder="Azienda Srl"
                value={form.ragione_sociale}
                onChange={(e) => update('ragione_sociale', e.target.value)}
                style={errors.ragione_sociale ? { borderColor: '#ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.15)' } : {}}
              />
              {errors.ragione_sociale && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4 }}>{errors.ragione_sociale}</p>}
              <p style={{ color: '#475569', fontSize: '0.72rem', marginTop: 4 }}>Includi la forma giuridica (es. Srl, Spa, Snc, Sas...)</p>
            </div>

            <div>
              <label className="form-label">Email aziendale</label>
              <input
                className="form-input"
                type="email"
                placeholder="nome@azienda.it"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                autoComplete="email"
                style={errors.email ? { borderColor: '#ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.15)' } : {}}
              />
              {errors.email && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4 }}>{errors.email}</p>}
            </div>

            <div>
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Min 8 car., maiuscola, numero, simbolo"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                autoComplete="new-password"
                style={errors.password ? { borderColor: '#ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.15)' } : {}}
              />
              {errors.password && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4 }}>{errors.password}</p>}
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
                  Creazione account...
                </span>
              ) : (
                'Crea account gratuito'
              )}
            </button>

            <p style={{ fontSize: '0.78rem', color: '#475569', textAlign: 'center', marginTop: 4 }}>
              Registrandoti accetti i Termini di Servizio e la Privacy Policy.
            </p>
          </form>
        </motion.div>
      </motion.div>
    </div>
  )
}
