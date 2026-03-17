import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Sun, Gift } from 'lucide-react'

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
    email: '',
    password: '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function update(k: string, v: string) {
    setForm((f) => ({ ...f, [k]: v }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
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

        {/* Badge */}
        <motion.div variants={item} className="flex justify-center mb-6">
          <span
            className="badge badge-amber flex items-center gap-2"
            style={{ padding: '0.5rem 1rem', fontSize: '0.85rem', borderRadius: 12 }}
          >
            <Gift size={14} />
            2 ortomosaici gratuiti inclusi
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
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Nome referente</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="Mario Rossi"
                  value={form.name}
                  onChange={(e) => update('name', e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="form-label">Partita IVA</label>
                <input
                  className="form-input"
                  type="text"
                  placeholder="IT12345678901"
                  value={form.vat_number}
                  onChange={(e) => update('vat_number', e.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="form-label">Email aziendale</label>
              <input
                className="form-input"
                type="email"
                placeholder="nome@azienda.it"
                value={form.email}
                onChange={(e) => update('email', e.target.value)}
                required
                autoComplete="email"
              />
            </div>

            <div>
              <label className="form-label">Password</label>
              <input
                className="form-input"
                type="password"
                placeholder="Minimo 8 caratteri"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
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
