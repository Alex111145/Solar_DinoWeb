import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, LogOut, Users, BarChart2, Star, FileText,
  Check, X, ChevronDown, TrendingUp, Building2, Euro,
} from 'lucide-react'
import { apiFetch } from '../api'

// ── Types ──────────────────────────────────────────────────────────────────
interface Stats {
  active_companies?: number
  total_panels?: number
  total_revenue?: number
  monthly_revenue?: number
}

interface Company {
  id: string
  ragione_sociale?: string
  name?: string
  email?: string
  credits?: number
  is_active?: boolean
  panel_count?: number
  mission_count?: number
}

interface BonificoRequest {
  id: string
  company_name?: string
  amount?: number
  created_at?: string
  status?: string
}

interface ReviewItem {
  id: string
  name?: string
  rating?: number
  comment?: string
  created_at?: string
}

interface BillingItem {
  id: string
  company_name?: string
  mission_count?: number
  total_spent?: number
}

// ── Animated counter ───────────────────────────────────────────────────────
function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0)
  const raf = useRef<number | null>(null)

  useEffect(() => {
    const start = 0
    const end = value
    const duration = 1200
    const startTime = performance.now()

    function step(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(start + (end - start) * eased))
      if (progress < 1) raf.current = requestAnimationFrame(step)
    }

    raf.current = requestAnimationFrame(step)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [value])

  return <>{prefix}{display.toLocaleString('it-IT')}{suffix}</>
}

// ── Company Detail Modal ───────────────────────────────────────────────────
function CompanyModal({ company, onClose }: { company: Company; onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="card"
        style={{ maxWidth: 520, width: '100%', padding: '2rem', borderRadius: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ color: '#f1f5f9', fontSize: '1.1rem', fontWeight: 700 }}>
            {company.ragione_sociale || company.name}
          </h3>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { label: 'Email', value: company.email || '—' },
            { label: 'Crediti', value: String(company.credits ?? 0) },
            { label: 'Elaborazioni', value: String(company.mission_count ?? 0) },
            { label: 'Pannelli totali', value: String(company.panel_count ?? 0) },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-xl p-3"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div style={{ fontSize: '0.72rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
              <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.925rem' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Simple usage bar chart placeholder */}
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 8 }}>Utilizzo mensile (ultimi 6 mesi)</div>
          <div className="flex items-end gap-2" style={{ height: 60 }}>
            {[3, 7, 5, 12, 8, company.mission_count || 4].map((v, i) => (
              <motion.div
                key={i}
                initial={{ height: 0 }}
                animate={{ height: `${(v / 14) * 100}%` }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                style={{
                  flex: 1,
                  background: i === 5 ? 'linear-gradient(180deg,#f59e0b,#f97316)' : 'rgba(245,158,11,0.25)',
                  borderRadius: '4px 4px 0 0',
                  minHeight: 4,
                }}
              />
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Main Admin Page ────────────────────────────────────────────────────────
export default function AdminPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'companies' | 'billing' | 'bonifici' | 'reviews'>('companies')

  const [stats, setStats] = useState<Stats>({})
  const [companies, setCompanies] = useState<Company[]>([])
  const [billing, setBilling] = useState<BillingItem[]>([])
  const [bonifici, setBonifici] = useState<BonificoRequest[]>([])
  const [adminReviews, setAdminReviews] = useState<ReviewItem[]>([])

  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [msg, setMsg] = useState('')

  const [pendingBonifici, setPendingBonifici] = useState(0)
  const [pendingReviews, setPendingReviews] = useState(0)

  // ── Load data ────────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch('/admin/stats').then((r) => r.json()).then((d) => setStats(d)).catch(() => {})
    apiFetch('/admin/companies').then((r) => r.json()).then((d) => {
      const arr = Array.isArray(d) ? d : d.companies || []
      setCompanies(arr)
    }).catch(() => {})
    apiFetch('/admin/billing').then((r) => r.json()).then((d) => {
      setBilling(Array.isArray(d) ? d : d.billing || [])
    }).catch(() => {})
    apiFetch('/admin/bonifico-requests').then((r) => r.json()).then((d) => {
      const arr = Array.isArray(d) ? d : d.requests || []
      setBonifici(arr)
      setPendingBonifici(arr.filter((b: BonificoRequest) => !b.status || b.status === 'pending').length)
    }).catch(() => {})
    apiFetch('/admin/reviews').then((r) => r.json()).then((d) => {
      const arr = Array.isArray(d) ? d : d.reviews || []
      setAdminReviews(arr)
      setPendingReviews(arr.filter((r: ReviewItem & { approved?: boolean }) => !r.approved).length)
    }).catch(() => {})
  }, [])

  // ── Actions ──────────────────────────────────────────────────────────
  async function toggleCompany(id: string, activate: boolean) {
    const path = activate ? `/admin/companies/${id}/activate` : `/admin/companies/${id}/deactivate`
    try {
      const res = await apiFetch(path, { method: 'POST' })
      if (res.ok) {
        setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, is_active: activate } : c))
        setMsg(activate ? 'Azienda attivata' : 'Azienda disattivata')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
  }

  async function handleBonifico(id: string, action: 'approve' | 'reject') {
    try {
      const res = await apiFetch(`/admin/bonifico-requests/${id}/${action}`, { method: 'POST' })
      if (res.ok) {
        setBonifici((prev) => prev.filter((b) => b.id !== id))
        setPendingBonifici((n) => Math.max(0, n - 1))
        setMsg(action === 'approve' ? 'Bonifico approvato' : 'Bonifico rifiutato')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
  }

  async function handleReview(id: string, action: 'approve' | 'reject') {
    try {
      const res = await apiFetch(`/admin/reviews/${id}/${action}`, { method: 'POST' })
      if (res.ok) {
        setAdminReviews((prev) => prev.filter((r) => r.id !== id))
        setPendingReviews((n) => Math.max(0, n - 1))
        setMsg(action === 'approve' ? 'Recensione approvata' : 'Recensione rifiutata')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
  }

  const cardAnim = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }
  const containerAnim = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } }

  const statCards = [
    { icon: <Building2 size={18} />, label: 'Aziende attive', value: stats.active_companies || 0, prefix: '' },
    { icon: <BarChart2 size={18} />, label: 'Pannelli rilevati', value: stats.total_panels || 0, prefix: '' },
    { icon: <Euro size={18} />, label: 'Fatturato totale', value: stats.total_revenue || 0, prefix: '€' },
    { icon: <TrendingUp size={18} />, label: 'Fatturato mese', value: stats.monthly_revenue || 0, prefix: '€' },
  ]

  return (
    <div className="min-h-screen" style={{ background: '#060912', position: 'relative' }}>
      <div className="grid-overlay" />

      {/* Navbar */}
      <nav className="navbar-glass sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 36, height: 36, background: 'linear-gradient(135deg,#f59e0b,#f97316)', boxShadow: '0 0 16px rgba(245,158,11,0.35)' }}
            >
              <Sun size={18} color="#000" strokeWidth={2.5} />
            </div>
            <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#f1f5f9', letterSpacing: '-0.02em' }}>SolarDino</span>
            <span className="badge badge-amber ml-1">Admin</span>
          </div>
          <button
            className="btn-ghost flex items-center gap-2"
            style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }}
            onClick={() => { localStorage.clear(); navigate('/login') }}
          >
            <LogOut size={15} /> Esci
          </button>
        </div>
      </nav>

      <motion.div
        className="max-w-7xl mx-auto px-4 py-8"
        variants={containerAnim}
        initial="hidden"
        animate="show"
        style={{ position: 'relative', zIndex: 1 }}
      >
        {/* Header */}
        <motion.div variants={cardAnim} className="mb-8">
          <h1 style={{ fontSize: 'clamp(1.5rem, 3vw, 2rem)', fontWeight: 800, letterSpacing: '-0.03em', color: '#f1f5f9', marginBottom: 6 }}>
            Dashboard <span className="text-amber-gradient">Admin</span>
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.9rem' }}>Gestisci aziende, pagamenti e contenuti</p>
        </motion.div>

        {/* Feedback msg */}
        <AnimatePresence>
          {msg && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-xl p-3.5 mb-4"
              style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', fontSize: '0.875rem' }}
            >
              {msg}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats row */}
        <motion.div variants={cardAnim} className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {statCards.map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className="card flex flex-col gap-3"
            >
              <div
                style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}
              >
                {s.icon}
              </div>
              <div>
                <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: 3 }}>{s.label}</div>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.03em' }}>
                  <AnimatedNumber value={s.value} prefix={s.prefix} />
                </div>
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Tabs */}
        <motion.div variants={cardAnim} className="card" style={{ padding: '0.375rem' }}>
          <div className="flex gap-1 flex-wrap">
            {[
              { key: 'companies', label: 'Aziende', icon: <Users size={14} /> },
              { key: 'billing', label: 'Utilizzo & Fatturazione', icon: <BarChart2 size={14} /> },
              { key: 'bonifici', label: 'Bonifici', icon: <FileText size={14} />, badge: pendingBonifici },
              { key: 'reviews', label: 'Recensioni', icon: <Star size={14} />, badge: pendingReviews },
            ].map((t) => (
              <button
                key={t.key}
                className={`tab-btn flex items-center gap-1.5 ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key as typeof tab)}
              >
                {t.icon}
                {t.label}
                {!!t.badge && (
                  <span
                    className="inline-flex items-center justify-center rounded-full text-xs font-bold"
                    style={{ width: 18, height: 18, background: '#ef4444', color: '#fff', fontSize: '0.65rem' }}
                  >
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Tab content */}
        <AnimatePresence mode="wait">
          {tab === 'companies' && (
            <motion.div
              key="companies"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="card mt-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem' }}>
                  Aziende registrate ({companies.length})
                </h3>
              </div>

              {companies.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                  Nessuna azienda registrata
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Azienda</th>
                        <th>Email</th>
                        <th>Crediti</th>
                        <th>Elaborazioni</th>
                        <th>Stato</th>
                        <th>Azioni</th>
                      </tr>
                    </thead>
                    <tbody>
                      {companies.map((c) => (
                        <tr
                          key={c.id}
                          style={{ cursor: 'pointer' }}
                          onClick={() => setSelectedCompany(c)}
                        >
                          <td style={{ color: '#f1f5f9', fontWeight: 500 }}>
                            {c.ragione_sociale || c.name || '—'}
                          </td>
                          <td>{c.email || '—'}</td>
                          <td>
                            <span style={{ color: '#f59e0b', fontWeight: 600 }}>{c.credits ?? 0}</span>
                          </td>
                          <td>{c.mission_count ?? 0}</td>
                          <td>
                            <span className={`badge ${c.is_active ? 'badge-green' : 'badge-red'}`}>
                              {c.is_active ? 'Attiva' : 'Disabilitata'}
                            </span>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
                            <div className="flex gap-2">
                              {c.is_active ? (
                                <button
                                  className="btn-ghost"
                                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }}
                                  onClick={() => toggleCompany(c.id, false)}
                                >
                                  Disabilita
                                </button>
                              ) : (
                                <button
                                  className="btn-ghost"
                                  style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem', color: '#22c55e', borderColor: 'rgba(34,197,94,0.25)' }}
                                  onClick={() => toggleCompany(c.id, true)}
                                >
                                  Attiva
                                </button>
                              )}
                              <button
                                className="btn-ghost"
                                style={{ padding: '0.3rem 0.75rem', fontSize: '0.75rem' }}
                                onClick={() => setSelectedCompany(c)}
                              >
                                Dettaglio <ChevronDown size={12} style={{ transform: 'rotate(-90deg)' }} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}

          {tab === 'billing' && (
            <motion.div
              key="billing"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="card mt-4"
            >
              <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
                Riepilogo fatturazione per azienda
              </h3>

              {billing.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                  Nessun dato di fatturazione disponibile
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>Azienda</th>
                        <th>Elaborazioni</th>
                        <th>Totale speso</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billing.map((b) => (
                        <tr key={b.id}>
                          <td style={{ color: '#f1f5f9' }}>{b.company_name || '—'}</td>
                          <td>{b.mission_count ?? 0}</td>
                          <td style={{ color: '#f59e0b', fontWeight: 600 }}>€{(b.total_spent ?? 0).toFixed(2)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.div>
          )}

          {tab === 'bonifici' && (
            <motion.div
              key="bonifici"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="card mt-4"
            >
              <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
                Richieste bonifico
              </h3>

              {bonifici.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                  Nessuna richiesta in attesa
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {bonifici.map((b) => (
                    <div
                      key={b.id}
                      className="rounded-xl p-4 flex items-center justify-between gap-4 flex-wrap"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                    >
                      <div>
                        <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.9rem', marginBottom: 2 }}>
                          {b.company_name || '—'}
                        </div>
                        <div style={{ fontSize: '0.8rem', color: '#64748b' }}>
                          {b.amount ? `€${b.amount}` : ''} · {b.created_at ? new Date(b.created_at).toLocaleDateString('it-IT') : '—'}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="btn-ghost flex items-center gap-1.5"
                          style={{ color: '#22c55e', borderColor: 'rgba(34,197,94,0.25)', fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
                          onClick={() => handleBonifico(b.id, 'approve')}
                        >
                          <Check size={13} /> Approva
                        </button>
                        <button
                          className="btn-ghost flex items-center gap-1.5"
                          style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)', fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
                          onClick={() => handleBonifico(b.id, 'reject')}
                        >
                          <X size={13} /> Rifiuta
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </motion.div>
          )}

          {tab === 'reviews' && (
            <motion.div
              key="reviews"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="card mt-4"
            >
              <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
                Recensioni in attesa
              </h3>

              {adminReviews.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                  Nessuna recensione in attesa
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {adminReviews.map((r) => (
                    <div
                      key={r.id}
                      className="rounded-xl p-4"
                      style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                    >
                      <div className="flex items-start justify-between gap-4 flex-wrap">
                        <div style={{ flex: 1 }}>
                          <div className="flex items-center gap-2 mb-1.5">
                            <div className="flex gap-0.5">
                              {[1, 2, 3, 4, 5].map((n) => (
                                <Star
                                  key={n}
                                  size={13}
                                  fill={(r.rating || 0) >= n ? '#f59e0b' : 'none'}
                                  color={(r.rating || 0) >= n ? '#f59e0b' : '#475569'}
                                />
                              ))}
                            </div>
                            <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{r.name || 'Utente'}</span>
                            <span style={{ fontSize: '0.75rem', color: '#475569' }}>
                              {r.created_at ? new Date(r.created_at).toLocaleDateString('it-IT') : ''}
                            </span>
                          </div>
                          {r.comment && (
                            <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: 0 }}>{r.comment}</p>
                          )}
                        </div>
                        <div className="flex gap-2 flex-shrink-0">
                          <button
                            className="btn-ghost flex items-center gap-1.5"
                            style={{ color: '#22c55e', borderColor: 'rgba(34,197,94,0.25)', fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
                            onClick={() => handleReview(r.id, 'approve')}
                          >
                            <Check size={13} /> Approva
                          </button>
                          <button
                            className="btn-ghost flex items-center gap-1.5"
                            style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)', fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
                            onClick={() => handleReview(r.id, 'reject')}
                          >
                            <X size={13} /> Rifiuta
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
          )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Company detail modal */}
      <AnimatePresence>
        {selectedCompany && (
          <CompanyModal company={selectedCompany} onClose={() => setSelectedCompany(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
