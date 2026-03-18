import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, LogOut, Users, BarChart2, Star,
  Check, X, TrendingUp, Building2, Euro,
  FolderOpen, FileDown, ChevronRight, ChevronDown, Radio,
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
  vat_number?: string
  email?: string
  credits?: number
  total_credits_bought?: number
  is_active?: boolean
  panel_count?: number
  mission_count?: number
}

interface ReviewItem {
  id: string
  company?: string
  stars?: number
  comment?: string
  created_at?: string
  status?: string
}

interface BillingItem {
  id: string
  company_name?: string
  mission_count?: number
  total_spent?: number
  credits_remaining?: number
  payment_method?: string
  receipt_url?: string
  stripe_receipt_url?: string
}

interface UploadedFile {
  name: string
  size_mb: number
}

interface UploadJob {
  job_id: string
  tif_filename?: string
  status: string
  created_at: string
  files: UploadedFile[]
}

interface UploadCompany {
  company_id: number
  company_name: string
  company_email: string
  jobs: UploadJob[]
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
  const months = ['Ott', 'Nov', 'Dic', 'Gen', 'Feb', 'Mar']
  const revenues = [149, 349, 219, 449, 299, (company.mission_count || 2) * 49.99]
  const maxRevenue = Math.max(...revenues, 1)

  const yLabels = [0, Math.round(maxRevenue / 2), Math.round(maxRevenue)]

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="card"
        style={{ maxWidth: 560, width: '100%', padding: '2rem', borderRadius: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 style={{ color: '#f1f5f9', fontSize: '1.1rem', fontWeight: 700, marginBottom: 2 }}>
              {company.ragione_sociale || company.name || '—'}
            </h3>
            {company.ragione_sociale && company.name && (
              <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{company.name}</div>
            )}
          </div>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-5">
          {[
            { label: 'Ragione sociale', value: company.ragione_sociale || '—' },
            { label: 'Partita IVA', value: company.vat_number || '—' },
            { label: 'Nome referente', value: company.name || '—' },
            { label: 'Email', value: company.email || '—' },
            { label: 'Crediti residui', value: String(company.credits ?? 0) },
            { label: 'Elaborazioni', value: String(company.mission_count ?? 0) },
            { label: 'Pannelli rilevati', value: String(company.panel_count ?? 0) },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-xl p-3"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
            >
              <div style={{ fontSize: '0.68rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</div>
              <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.875rem', wordBreak: 'break-all' }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Bar chart with X and Y axes */}
        <div>
          <div style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 10, fontWeight: 600 }}>
            Fatturato stimato (ultimi 6 mesi)
          </div>
          <div className="flex gap-2">
            {/* Y axis */}
            <div className="flex flex-col justify-between items-end" style={{ height: 100, paddingBottom: 20 }}>
              {yLabels.slice().reverse().map((v) => (
                <span key={v} style={{ fontSize: '0.62rem', color: '#475569' }}>€{v}</span>
              ))}
            </div>

            {/* Chart area */}
            <div style={{ flex: 1 }}>
              <div className="flex items-end gap-1.5" style={{ height: 80, borderLeft: '1px solid rgba(255,255,255,0.08)', borderBottom: '1px solid rgba(255,255,255,0.08)', paddingLeft: 4 }}>
                {revenues.map((v, i) => (
                  <motion.div
                    key={i}
                    initial={{ height: 0 }}
                    animate={{ height: `${(v / maxRevenue) * 100}%` }}
                    transition={{ delay: i * 0.08, duration: 0.5 }}
                    style={{
                      flex: 1,
                      background: i === revenues.length - 1 ? 'linear-gradient(180deg,#f59e0b,#f97316)' : 'rgba(245,158,11,0.25)',
                      borderRadius: '4px 4px 0 0',
                      minHeight: 3,
                    }}
                  />
                ))}
              </div>
              {/* X axis labels */}
              <div className="flex gap-1.5" style={{ paddingLeft: 4, marginTop: 4 }}>
                {months.map((m) => (
                  <div key={m} style={{ flex: 1, textAlign: 'center', fontSize: '0.62rem', color: '#475569' }}>{m}</div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}

// ── Main Admin Page ────────────────────────────────────────────────────────
export default function AdminPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'companies' | 'billing' | 'reviews' | 'uploads' | 'enterprise'>('companies')

  const [stats, setStats] = useState<Stats>({})
  const [companies, setCompanies] = useState<Company[]>([])
  const [billing, setBilling] = useState<BillingItem[]>([])
  const [adminReviews, setAdminReviews] = useState<ReviewItem[]>([])

  const [uploads, setUploads] = useState<UploadCompany[]>([])
  const [expandedCompany, setExpandedCompany] = useState<number | null>(null)
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [enterpriseLogs, setEnterpriseLogs] = useState<{id:number,company_name:string,company_email:string,vat_number:string,fh_workspace_id:string,data_consent:boolean,created_at:string}[]>([])

  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [msg, setMsg] = useState('')

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
    apiFetch('/admin/reviews').then((r) => r.json()).then((d) => {
      const arr = Array.isArray(d) ? d : d.reviews || []
      setAdminReviews(arr)
      setPendingReviews(arr.filter((r: ReviewItem) => r.status !== 'approved' && r.status !== 'approvata' && r.status !== 'rejected').length)
    }).catch(() => {})
    apiFetch('/admin/uploads').then((r) => r.json()).then((d) => {
      setUploads(Array.isArray(d) ? d : [])
    }).catch(() => {})
    apiFetch('/admin/enterprise-logs').then((r) => r.json()).then((d) => {
      setEnterpriseLogs(Array.isArray(d) ? d : [])
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

  async function handleReview(id: string, action: 'approve' | 'reject') {
    try {
      const res = await apiFetch(`/admin/reviews/${id}/${action}`, { method: 'POST' })
      if (res.ok) {
        if (action === 'approve') {
          setAdminReviews((prev) => prev.map((r) => r.id === id ? { ...r, status: 'approved' } : r))
          setPendingReviews((n) => Math.max(0, n - 1))
        } else {
          setAdminReviews((prev) => prev.filter((r) => r.id !== id))
          setPendingReviews((n) => Math.max(0, n - 1))
        }
        setMsg(action === 'approve' ? 'Recensione approvata' : 'Recensione rifiutata')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
  }

  async function deleteReview(id: string) {
    try {
      const res = await apiFetch(`/admin/reviews/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setAdminReviews((prev) => prev.filter((r) => r.id !== id))
        setMsg('Recensione eliminata')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
  }

  const cardAnim = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }
  const containerAnim = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } }

  const statCards = [
    { icon: <Building2 size={18} />, label: 'Aziende attive', value: stats.active_companies || 0, prefix: '' },
    { icon: <BarChart2 size={18} />, label: 'Pannelli rilevati', value: stats.total_panels || 0, prefix: '' },
    { icon: <TrendingUp size={18} />, label: 'Fatturato mese', value: stats.monthly_revenue || 0, prefix: '€' },
    { icon: <Euro size={18} />, label: 'Fatturato totale', value: stats.total_revenue || 0, prefix: '€' },
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
          <div className="flex gap-1 flex-wrap justify-center">
            {[
              { key: 'companies', label: 'Aziende', icon: <Users size={14} /> },
              { key: 'billing', label: 'Utilizzo & Fatturazione', icon: <BarChart2 size={14} /> },
              { key: 'reviews', label: 'Recensioni', icon: <Star size={14} />, badge: pendingReviews },
              { key: 'uploads', label: 'Dati caricati', icon: <FolderOpen size={14} /> },
              { key: 'enterprise', label: 'Enterprise', icon: <Radio size={14} /> },
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
                        <th>Crediti rimasti</th>
                        <th>Crediti acquistati</th>
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
                          <td>{c.total_credits_bought ?? c.mission_count ?? 0}</td>
                          <td>
                            <span className={`badge ${c.is_active ? 'badge-green' : 'badge-red'}`}>
                              {c.is_active ? 'Attivato' : 'Disabilitata'}
                            </span>
                          </td>
                          <td onClick={(e) => e.stopPropagation()}>
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
                        <th>Crediti rimasti</th>
                        <th>Totale speso</th>
                        <th>Metodo pagamento</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billing.map((b) => (
                        <tr key={b.id}>
                          <td style={{ color: '#f1f5f9' }}>{b.company_name || '—'}</td>
                          <td><span style={{ color: '#f59e0b', fontWeight: 600 }}>{b.credits_remaining ?? '—'}</span></td>
                          <td style={{ color: '#f59e0b', fontWeight: 600 }}>€{(b.total_spent ?? 0).toFixed(2)}</td>
                          <td>
                            {!b.payment_method || b.payment_method === 'stripe' ? (
                              b.stripe_receipt_url ? (
                                <a
                                  href={b.stripe_receipt_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="btn-ghost flex items-center gap-1"
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', color: '#f59e0b', borderColor: 'rgba(245,158,11,0.25)', display: 'inline-flex' }}
                                >
                                  Stripe →
                                </a>
                              ) : (
                                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Carta</span>
                              )
                            ) : (
                              b.receipt_url ? (
                                <a
                                  href={b.receipt_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  download
                                  className="btn-ghost flex items-center gap-1"
                                  style={{ fontSize: '0.75rem', padding: '0.25rem 0.6rem', display: 'inline-flex' }}
                                >
                                  Ricevuta ↓
                                </a>
                              ) : (
                                <span style={{ fontSize: '0.78rem', color: '#64748b' }}>Bonifico</span>
                              )
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
                Recensioni ({adminReviews.length})
              </h3>

              {adminReviews.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                  Nessuna recensione
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {adminReviews.map((r) => {
                    const approved = r.status === 'approved' || r.status === 'approvata'
                    return (
                      <div
                        key={r.id}
                        className="rounded-xl p-4"
                        style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${approved ? 'rgba(34,197,94,0.15)' : 'rgba(255,255,255,0.07)'}` }}
                      >
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div style={{ flex: 1 }}>
                            <div className="flex items-center gap-2 mb-1.5">
                              <div className="flex gap-0.5">
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <Star
                                    key={n}
                                    size={13}
                                    fill={(r.stars || 0) >= n ? '#f59e0b' : 'none'}
                                    color={(r.stars || 0) >= n ? '#f59e0b' : '#475569'}
                                  />
                                ))}
                              </div>
                              <span style={{ fontSize: '0.8rem', color: '#64748b' }}>{r.company || 'Azienda'}</span>
                              <span style={{ fontSize: '0.75rem', color: '#475569' }}>
                                {r.created_at ? new Date(r.created_at).toLocaleDateString('it-IT') : ''}
                              </span>
                              {approved && (
                                <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>Approvata</span>
                              )}
                            </div>
                            {r.comment && (
                              <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: 0 }}>{r.comment}</p>
                            )}
                          </div>
                          <div className="flex gap-2 flex-shrink-0">
                            {!approved && (
                              <button
                                className="btn-ghost flex items-center gap-1.5"
                                style={{ color: '#22c55e', borderColor: 'rgba(34,197,94,0.25)', fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
                                onClick={() => handleReview(r.id, 'approve')}
                              >
                                <Check size={13} /> Approva
                              </button>
                            )}
                            {!approved && (
                              <button
                                className="btn-ghost flex items-center gap-1.5"
                                style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)', fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
                                onClick={() => handleReview(r.id, 'reject')}
                              >
                                <X size={13} /> Rifiuta
                              </button>
                            )}
                            {approved && (
                              <button
                                className="btn-ghost flex items-center gap-1.5"
                                style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)', fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
                                onClick={() => deleteReview(r.id)}
                              >
                                <X size={13} /> Elimina
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </motion.div>
          )}
          {tab === 'uploads' && (
            <motion.div
              key="uploads"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="card mt-4"
            >
              <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
                File caricati dagli utenti
              </h3>

              {uploads.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                  Nessun file caricato
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {uploads.map((company) => {
                    const isCompanyOpen = expandedCompany === company.company_id
                    const totalFiles = company.jobs.reduce((s, j) => s + j.files.length, 0)
                    return (
                      <div
                        key={company.company_id}
                        className="rounded-xl overflow-hidden"
                        style={{ border: '1px solid rgba(255,255,255,0.08)' }}
                      >
                        {/* Company header */}
                        <button
                          className="w-full flex items-center justify-between p-4"
                          style={{ background: 'rgba(255,255,255,0.03)', border: 'none', cursor: 'pointer', color: '#f1f5f9' }}
                          onClick={() => setExpandedCompany(isCompanyOpen ? null : company.company_id)}
                        >
                          <div className="flex items-center gap-3">
                            <FolderOpen size={16} style={{ color: '#f59e0b', flexShrink: 0 }} />
                            <div style={{ textAlign: 'left' }}>
                              <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{company.company_name}</div>
                              <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{company.company_email}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}>
                              {company.jobs.length} job · {totalFiles} file
                            </span>
                            {isCompanyOpen
                              ? <ChevronDown size={15} style={{ color: '#64748b' }} />
                              : <ChevronRight size={15} style={{ color: '#64748b' }} />
                            }
                          </div>
                        </button>

                        {/* Jobs list */}
                        {isCompanyOpen && (
                          <div style={{ padding: '0.5rem 1rem 1rem' }}>
                            {company.jobs.map((job) => {
                              const isJobOpen = expandedJob === job.job_id
                              return (
                                <div
                                  key={job.job_id}
                                  className="rounded-xl overflow-hidden mb-2"
                                  style={{ border: '1px solid rgba(255,255,255,0.06)' }}
                                >
                                  {/* Job header */}
                                  <button
                                    className="w-full flex items-center justify-between p-3"
                                    style={{ background: 'rgba(255,255,255,0.02)', border: 'none', cursor: 'pointer', color: '#f1f5f9' }}
                                    onClick={() => setExpandedJob(isJobOpen ? null : job.job_id)}
                                  >
                                    <div className="flex items-center gap-3">
                                      <div style={{ textAlign: 'left' }}>
                                        <div style={{ fontSize: '0.82rem', fontWeight: 500, color: '#f1f5f9' }}>
                                          {job.tif_filename || `Job ${job.job_id.slice(0, 8)}`}
                                        </div>
                                        <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                          {new Date(job.created_at).toLocaleDateString('it-IT')} · {job.files.length} file
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`badge ${job.status === 'completato' ? 'badge-green' : job.status === 'errore' ? 'badge-red' : 'badge-amber'}`} style={{ fontSize: '0.65rem' }}>
                                        {job.status}
                                      </span>
                                      {isJobOpen
                                        ? <ChevronDown size={14} style={{ color: '#64748b' }} />
                                        : <ChevronRight size={14} style={{ color: '#64748b' }} />
                                      }
                                    </div>
                                  </button>

                                  {/* File list */}
                                  {isJobOpen && (
                                    <div style={{ padding: '0.5rem 0.75rem 0.75rem', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                      {job.files.length === 0 ? (
                                        <div style={{ fontSize: '0.8rem', color: '#475569', padding: '0.5rem 0' }}>Nessun file trovato su disco</div>
                                      ) : (
                                        <div className="flex flex-col gap-1.5">
                                          {job.files.map((file) => (
                                            <div
                                              key={file.name}
                                              className="flex items-center justify-between rounded-lg px-3 py-2"
                                              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)' }}
                                            >
                                              <div>
                                                <span style={{ fontSize: '0.8rem', color: '#f1f5f9', fontWeight: 500 }}>{file.name}</span>
                                                <span style={{ fontSize: '0.7rem', color: '#475569', marginLeft: 8 }}>{file.size_mb} MB</span>
                                              </div>
                                              <a
                                                href={`/api/admin/jobs/${job.job_id}/files/${encodeURIComponent(file.name)}`}
                                                download={file.name}
                                                onClick={async (e) => {
                                                  e.preventDefault()
                                                  const token = localStorage.getItem('token')
                                                  const res = await fetch(`/api/admin/jobs/${job.job_id}/files/${encodeURIComponent(file.name)}`, {
                                                    headers: { Authorization: `Bearer ${token}` },
                                                  })
                                                  if (!res.ok) return
                                                  const blob = await res.blob()
                                                  const url = URL.createObjectURL(blob)
                                                  const a = document.createElement('a')
                                                  a.href = url
                                                  a.download = file.name
                                                  a.click()
                                                  URL.revokeObjectURL(url)
                                                }}
                                                className="btn-ghost flex items-center gap-1.5"
                                                style={{ fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}
                                              >
                                                <FileDown size={13} /> Scarica
                                              </a>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </motion.div>
          )}
          {tab === 'enterprise' && (
            <motion.div
              key="enterprise"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="card mt-4"
            >
              <div className="flex items-center justify-between mb-4">
                <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', margin: 0 }}>
                  Clienti Enterprise — Log Inferenze
                </h3>
                <a
                  href="/admin/enterprise-logs/csv"
                  download
                  onClick={(e) => {
                    e.preventDefault()
                    const token = localStorage.getItem('token')
                    fetch('/admin/enterprise-logs/csv', { headers: { Authorization: `Bearer ${token}` } })
                      .then((r) => r.blob())
                      .then((blob) => {
                        const url = URL.createObjectURL(blob)
                        const a = document.createElement('a')
                        a.href = url; a.download = 'enterprise_clients.csv'; a.click()
                        URL.revokeObjectURL(url)
                      })
                  }}
                  className="btn-ghost flex items-center gap-1.5"
                  style={{ fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
                >
                  <FileDown size={13} /> Esporta CSV
                </a>
              </div>

              {enterpriseLogs.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                  Nessun cliente Enterprise ha ancora avviato l'inferenza
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {enterpriseLogs.map((l) => (
                    <div key={l.id} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.875rem' }}>{l.company_name || l.company_email}</div>
                          <div style={{ fontSize: '0.75rem', color: '#64748b', marginTop: 2 }}>{l.company_email}</div>
                          {l.vat_number && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>P.IVA: {l.vat_number}</div>}
                          {l.fh_workspace_id && <div style={{ fontSize: '0.75rem', color: '#64748b' }}>Workspace: {l.fh_workspace_id}</div>}
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>
                            <Check size={9} /> Consenso dati
                          </span>
                          <span style={{ fontSize: '0.72rem', color: '#64748b' }}>
                            {new Date(l.created_at).toLocaleString('it-IT')}
                          </span>
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
