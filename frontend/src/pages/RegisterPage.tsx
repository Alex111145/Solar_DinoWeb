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

export default function RegisterPage() {
  const navigate = useNavigate()
  const [form, setForm] = useState({
    ragione_sociale: '',
    name: '',
    vat_number: '',
    pec: '',
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

    // Ragione sociale: must contain a legal form
    if (!form.ragione_sociale.trim()) {
      e.ragione_sociale = 'Campo obbligatorio'
    } else if (!/\b(srl|s\.r\.l|spa|s\.p\.a|snc|s\.n\.c|sas|s\.a\.s|srls|s\.r\.l\.s|ss|s\.s|soc\.|societa)\b/i.test(form.ragione_sociale)) {
      e.ragione_sociale = 'Inserire la forma giuridica (es. Srl, Spa, Snc...)'
    }

    // Nome referente: first name ≥2 chars, last name ≥2 chars
    const parts = form.name.trim().split(/\s+/)
    if (!form.name.trim()) {
      e.name = 'Campo obbligatorio'
    } else if (parts.length < 2 || parts[0].length < 2 || parts[parts.length - 1].length < 2) {
      e.name = 'Inserire nome e cognome (min. 2 lettere ciascuno)'
    }

    // Partita IVA: exactly 11 digits, no IT prefix
    if (!form.vat_number.trim()) {
      e.vat_number = 'Partita IVA obbligatoria'
    } else if (/^it/i.test(form.vat_number.trim())) {
      e.vat_number = 'Inserire solo le 11 cifre numeriche, senza prefisso IT'
    } else if (!/^\d{11}$/.test(form.vat_number.trim())) {
      e.vat_number = 'La Partita IVA deve contenere esattamente 11 cifre'
    }

    // PEC: required + valid email format
    if (!form.pec.trim()) {
      e.pec = 'PEC aziendale obbligatoria'
    } else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(form.pec)) {
      e.pec = 'Formato PEC non valido (es. nome@arubapec.it)'
    }

    // Email: must have @ and a domain with at least one dot + 2-char TLD
    if (!form.email.trim()) {
      e.email = 'Email obbligatoria'
    } else if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(form.email)) {
      e.email = 'Email non valida (es. nome@azienda.it)'
    }

    // Password: 8+ chars, uppercase, number, special char
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
      localStorage.setItem('name', data.name || data.user?.name || form.name)
      localStorage.setItem('email', data.email || data.user?.email || form.email)
      localStorage.setItem('credits', String(data.credits ?? data.user?.credits ?? 2))
      localStorage.setItem('is_admin', String(data.is_admin ?? data.user?.is_admin ?? false))
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
          width: '700px',
          height: '700px',
          top: '-200px',
          right: '-100px',
          background: 'radial-gradient(circle, rgba(245,158,11,0.1) 0%, transparent 70%)',
          borderRadius: '50%',
          filter: 'blur(60px)',
          animation: 'aurora 22s ease-in-out infinite',
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          width: '500px',
          height: '500px',
          bottom: '-100px',
          left: '5%',
          background: 'radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 70%)',
          borderRadius: '50%',
          filter: 'blur(50px)',
          animation: 'aurora 30s ease-in-out infinite reverse',
        }}
      />

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        style={{ width: '100%', maxWidth: 520, position: 'relative', zIndex: 10 }}
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
        <motion.div
          variants={item}
          className="card"
          style={{ padding: '2.25rem', borderRadius: 24 }}
        >
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, color: '#f1f5f9', marginBottom: 4 }}>
            Crea il tuo account
          </h2>
          <p style={{ fontSize: '0.875rem', color: '#64748b', marginBottom: '1.75rem' }}>
            Hai già un account?{' '}
            <Link to="/login" style={{ color: '#f59e0b', fontWeight: 600 }}>
              Accedi
            </Link>
          </p>

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
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Cognome e Nome</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Mario Rossi"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  style={errors.name ? { borderColor: '#ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.15)' } : {}}
                />
                {errors.name && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4 }}>{errors.name}</p>}
              </div>
              <div>
                <label className="form-label">Partita IVA</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="12345678901"
                  value={form.vat_number}
                  onChange={(e) => update('vat_number', e.target.value)}
                  style={errors.vat_number ? { borderColor: '#ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.15)' } : {}}
                />
                {errors.vat_number && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4 }}>{errors.vat_number}</p>}
              </div>
            </div>

            <div>
              <label className="form-label">PEC aziendale</label>
              <input
                className="form-input"
                type="email"
                placeholder="nome@arubapec.it"
                value={form.pec}
                onChange={(e) => update('pec', e.target.value)}
                style={errors.pec ? { borderColor: '#ef4444', boxShadow: '0 0 0 2px rgba(239,68,68,0.15)' } : {}}
              />
              {errors.pec && <p style={{ color: '#ef4444', fontSize: '0.78rem', marginTop: 4 }}>{errors.pec}</p>}
              <p style={{ color: '#475569', fontSize: '0.72rem', marginTop: 4 }}>La PEC è obbligatoria per le aziende italiane (es. arubapec.it, legalmail.it)</p>
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
