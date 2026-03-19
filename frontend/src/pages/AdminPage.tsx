import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, LogOut, Users, BarChart2, Star,
  Check, X, TrendingUp, Building2, Euro,
  FolderOpen, FileDown, ChevronRight, ChevronDown, Radio, MessageSquare,
} from 'lucide-react'
import { apiFetch } from '../api'

// ── Types ──────────────────────────────────────────────────────────────────
interface Stats {
  active_companies?: number
  total_panels_detected?: number
  total_revenue_eur?: number
  revenue_month_eur?: number
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
  panels_detected?: number
  hotspot_count?: number
  mission_count?: number
  last_ip?: string
  ip_status?: 'ok' | 'warning'
  welcome_bonus_used?: boolean
  last_login_at?: string
  created_at?: string
}

interface ReviewItem {
  id: string
  company?: string
  stars?: number
  comment?: string
  created_at?: string
  status?: string
}

interface BillingPayment {
  id: string
  type: 'bonifico' | 'stripe'
  method_label: string
  credits: number
  amount_eur: number
  status: 'pending' | 'approved' | 'rejected'
  date: string
  receipt_id: number | null
}

interface BillingItem {
  id: number
  name?: string
  email?: string
  credits?: number
  jobs_completed?: number
  total_paid?: number
  payments?: BillingPayment[]
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

interface AdminTicket {
  id: number
  company_name?: string
  company_email?: string
  subject: string
  message: string
  status: 'aperto' | 'in_elaborazione' | 'risolto'
  created_at: string
}

const FAKE_ENTERPRISE = [
  { id: 1, company_name: 'SunTech Srl', company_email: 'ops@suntech.it', vat_number: '02345678901', fh_workspace_id: 'ws_suntech_prod_001', data_consent: true, created_at: '2026-03-10T09:14:00Z' },
  { id: 2, company_name: 'Greenfield Energy Spa', company_email: 'drone@greenfield.eu', vat_number: '04567890123', fh_workspace_id: 'ws_gfe_europe_003', data_consent: true, created_at: '2026-03-12T11:02:00Z' },
  { id: 3, company_name: 'Solar Pro Italia', company_email: 'info@solarproitalia.it', vat_number: '09876543210', fh_workspace_id: 'ws_spi_italia_07', data_consent: true, created_at: '2026-03-15T14:30:00Z' },
  { id: 4, company_name: 'Nord Energy Solutions', company_email: 'tech@nordenergy.it', vat_number: '01234567890', fh_workspace_id: 'ws_nes_nord_02', data_consent: true, created_at: '2026-03-17T08:55:00Z' },
  { id: 5, company_name: 'Adriatic Solar Srl', company_email: 'admin@adriaticsolar.com', vat_number: '07654321098', fh_workspace_id: 'ws_adriatic_live_05', data_consent: false, created_at: '2026-03-18T16:20:00Z' },
]

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
interface SupportTicket {
  id: number
  subject: string
  message: string
  created_at: string
}

function CompanyModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const months = ['Ott', 'Nov', 'Dic', 'Gen', 'Feb', 'Mar']
  const revenues = [149, 349, 219, 449, 299, (company.mission_count || 2) * 49.99]
  const maxRevenue = Math.max(...revenues, 1)

  const yLabels = [0, Math.round(maxRevenue / 2), Math.round(maxRevenue)]

  const [tickets, setTickets] = useState<SupportTicket[]>([])

  useEffect(() => {
    apiFetch(`/admin/companies/${company.id}/tickets`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setTickets(Array.isArray(d) ? d : []))
      .catch(() => {})
  }, [company.id])

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
            { label: 'Nome', value: company.name || '—' },
            { label: 'Email', value: company.email || '—' },
            { label: 'Crediti residui', value: String(company.credits ?? 0) },
            { label: 'Elaborazioni', value: String(company.mission_count ?? 0) },
            { label: 'Pannelli rilevati', value: String(company.panels_detected ?? 0) },
            { label: 'Hotspot rilevati', value: company.hotspot_count != null ? String(company.hotspot_count) : '—' },
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

        {/* Support Tickets */}
        {tickets.length > 0 && (
          <div style={{ marginTop: '1.5rem' }}>
            <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, marginBottom: 10 }}>
              Richieste di assistenza ({tickets.length})
            </div>
            <div className="flex flex-col gap-2" style={{ maxHeight: 280, overflowY: 'auto' }}>
              {tickets.map((t) => (
                <div
                  key={t.id}
                  className="rounded-xl p-3"
                  style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span style={{ fontSize: '0.8rem', color: '#f1f5f9', fontWeight: 600 }}>{t.subject}</span>
                    <span style={{ fontSize: '0.68rem', color: '#475569' }}>
                      {new Date(t.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: '#94a3b8', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{t.message}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ── Main Admin Page ────────────────────────────────────────────────────────
export default function AdminPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'companies' | 'billing' | 'reviews' | 'tickets' | 'uploads' | 'enterprise'>('companies')

  const [stats, setStats] = useState<Stats>({})
  const [companies, setCompanies] = useState<Company[]>([])
  const [billing, setBilling] = useState<BillingItem[]>([])
  const [adminReviews, setAdminReviews] = useState<ReviewItem[]>([])

  const [uploads, setUploads] = useState<UploadCompany[]>([])
  const [expandedCompany, setExpandedCompany] = useState<number | null>(null)
  const [expandedJob, setExpandedJob] = useState<string | null>(null)
  const [enterpriseLogs, setEnterpriseLogs] = useState<{id:number,company_name:string,company_email:string,vat_number:string,fh_workspace_id:string,data_consent:boolean,created_at:string}[]>([])

  const [selectedCompany, setSelectedCompany] = useState<Company | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [confirmCreditId, setConfirmCreditId] = useState<string | null>(null)
  const [confirmCreditStep, setConfirmCreditStep] = useState(0) // 0=chiuso, 1-3=step
  const [ipWarning, setIpWarning] = useState<{ target: Company; duplicate: Company } | null>(null)
  const [openDropdown, setOpenDropdown] = useState<string | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<{ id: string; name: string; activate: boolean } | null>(null)
  const [msg, setMsg] = useState('')

  const [pendingReviews, setPendingReviews] = useState(0)
  const [tickets, setTickets] = useState<AdminTicket[]>([])
  const [pendingTickets, setPendingTickets] = useState(0)

  // Billing filters
  const [billingFilterCompany, setBillingFilterCompany] = useState('')
  const [billingFilterMonth, setBillingFilterMonth] = useState('')
  const [billingFilterYear, setBillingFilterYear] = useState('')

  // Chiudi dropdown al click fuori
  useEffect(() => {
    if (!openDropdown) return
    const close = () => setOpenDropdown(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openDropdown])

  // ── Load data ────────────────────────────────────────────────────────
  function loadData() {
    apiFetch('/admin/stats').then((r) => r.ok ? r.json() : null).then((d) => { if (d) setStats(d) }).catch(() => {})
    apiFetch('/admin/companies').then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d) return
      setCompanies(Array.isArray(d) ? d : d.companies || [])
    }).catch(() => {})
    apiFetch('/admin/billing').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) setBilling(Array.isArray(d) ? d : d.billing || [])
    }).catch(() => {})
    apiFetch('/admin/reviews').then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d) return
      const arr = Array.isArray(d) ? d : d.reviews || []
      setAdminReviews(arr)
      setPendingReviews(arr.filter((r: ReviewItem) => r.status !== 'approved' && r.status !== 'approvata' && r.status !== 'rejected').length)
    }).catch(() => {})
    apiFetch('/admin/uploads').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) setUploads(Array.isArray(d) ? d : [])
    }).catch(() => {})
    apiFetch('/admin/enterprise-logs').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) setEnterpriseLogs(Array.isArray(d) ? d : [])
    }).catch(() => {})
    apiFetch('/admin/tickets').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) {
        const arr = Array.isArray(d) ? d : []
        setTickets(arr)
        setPendingTickets(arr.filter((t: AdminTicket) => t.status === 'aperto').length)
      }
    }).catch(() => {})
  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30_000) // refresh silenzioso ogni 30s
    return () => clearInterval(interval)
  }, [])

  // ── IP colour map: stessa IP → stesso colore ─────────────────────────
  const ipColorMap = useMemo(() => {
    const dupIps = new Set(
      companies.filter((c) => c.ip_status === 'warning' && c.last_ip).map((c) => c.last_ip!)
    )
    const palette = ['#f97316', '#a855f7', '#06b6d4', '#ec4899', '#84cc16']
    const map: Record<string, string> = {}
    let i = 0
    for (const ip of dupIps) { map[ip] = palette[i % palette.length]; i++ }
    return map
  }, [companies])

  // ── Actions ──────────────────────────────────────────────────────────
  async function toggleCompany(id: string, activate: boolean) {
    const path = activate ? `/admin/companies/${id}/activate` : `/admin/companies/${id}/deactivate`
    try {
      const res = await apiFetch(path, { method: 'POST' })
      if (res.ok) {
        setCompanies((prev) => {
          const updated = prev.map((c) => c.id === id ? { ...c, is_active: activate } : c)
          // Ricalcola ip_status: solo aziende attive contano per i duplicati
          const activeIps = updated
            .filter((c) => c.is_active && c.last_ip && c.last_ip !== '—')
            .map((c) => c.last_ip!)
          const dupSet = new Set(activeIps.filter((ip) => activeIps.filter((x) => x === ip).length > 1))
          return updated.map((c) => ({
            ...c,
            ip_status: (c.last_ip && c.last_ip !== '—' && dupSet.has(c.last_ip)) ? 'warning' : 'ok',
          }))
        })
        setMsg(activate ? 'Azienda attivata' : 'Azienda disattivata')
        setTimeout(() => setMsg(''), 3000)
      } else {
        const d = await res.json().catch(() => ({}))
        setMsg(`Errore: ${d.detail || res.status}`)
        setTimeout(() => setMsg(''), 4000)
      }
    } catch {
      setMsg('Errore di rete')
      setTimeout(() => setMsg(''), 3000)
    }
  }

  async function addCredit(id: string) {
    try {
      const res = await apiFetch(`/admin/companies/${id}/add-credit`, { method: 'POST' })
      if (res.ok) {
        const data = await res.json()
        setCompanies((prev) => prev.map((c) => c.id === id ? { ...c, credits: data.credits } : c))
        setMsg('+1 credito aggiunto')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
  }

  async function deleteCompany(id: string) {
    try {
      const res = await apiFetch(`/admin/companies/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setCompanies((prev) => prev.filter((c) => c.id !== id))
        setMsg('Azienda eliminata')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
    setConfirmDeleteId(null)
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

  async function updateTicketStatus(id: number, status: 'aperto' | 'in_elaborazione' | 'risolto') {
    try {
      const res = await apiFetch(`/admin/tickets/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setTickets((prev) => prev.map((t) => t.id === id ? { ...t, status } : t))
        setPendingTickets((prev) => tickets.filter((t) => (t.id === id ? status : t.status) === 'aperto').length)
        setMsg('Stato aggiornato')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
  }

  const cardAnim = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }
  const containerAnim = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } }

  // Media fatturato mensile: calcola i mesi da Gennaio 2025 a oggi
  const monthsSinceOnline = (() => {
    const start = new Date(2025, 0, 1) // Gennaio 2025
    const now = new Date()
    return Math.max(1, (now.getFullYear() - start.getFullYear()) * 12 + (now.getMonth() - start.getMonth()) + 1)
  })()
  const avgRevenuePerMonth = (stats.total_revenue_eur || 0) / monthsSinceOnline

  const statCards = [
    { icon: <Building2 size={18} />, label: 'Aziende attive', value: stats.active_companies || 0, prefix: '' },
    { icon: <BarChart2 size={18} />, label: 'Pannelli rilevati Totali', value: stats.total_panels_detected || 0, prefix: '' },
    { icon: <TrendingUp size={18} />, label: 'Fatturato medio mese', value: stats.revenue_month_eur || 0, prefix: '€' },
    { icon: <Euro size={18} />, label: 'Fatturato totale', value: stats.total_revenue_eur || 0, prefix: '€' },
    { icon: <TrendingUp size={18} />, label: 'Media mensile (da Gen 2025)', value: Math.round(avgRevenuePerMonth), prefix: '€' },
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
            onClick={async () => { await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {}); localStorage.clear(); navigate('/login') }}
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
        <motion.div variants={cardAnim} className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-4">
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
              { key: 'tickets', label: 'Segnalazioni', icon: <MessageSquare size={14} />, badge: pendingTickets },
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

              {/* Banner IP duplicati */}
              {companies.some(c => c.ip_status === 'warning') && (
                <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 10, padding: '0.75rem 1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: '1.1rem' }}>⚠️</span>
                  <div>
                    <div style={{ color: '#eab308', fontWeight: 700, fontSize: '0.85rem' }}>IP duplicati rilevati</div>
                    <div style={{ color: '#94a3b8', fontSize: '0.78rem' }}>
                      {companies.filter(c => c.ip_status === 'warning').length} aziende condividono lo stesso IP
                    </div>
                  </div>
                </div>
              )}

              {companies.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                  Nessuna azienda registrata
                </div>
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Azienda</th>
                      <th>Pannelli</th>
                      <th>Crediti</th>
                      <th>Registrata</th>
                      <th>Ultimo accesso</th>
                      <th>IP</th>
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
                        <td style={{ color: (c.last_ip && ipColorMap[c.last_ip]) || '#f1f5f9', fontWeight: 600 }}>
                          {c.ragione_sociale || c.name || '—'}
                        </td>
                        <td>
                          <span style={{ color: '#94a3b8', fontWeight: 600 }}>{c.panels_detected ?? 0}</span>
                        </td>
                        <td>
                          <span style={{ color: '#f59e0b', fontWeight: 600 }}>{c.credits ?? 0}</span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            {c.created_at ? new Date(c.created_at).toLocaleDateString('it-IT') : '—'}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                            {c.last_login_at ? new Date(c.last_login_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}
                          </span>
                        </td>
                        <td
                          onClick={(e) => {
                            e.stopPropagation()
                            if (c.ip_status === 'warning') {
                              const dup = companies.find((o) => o.id !== c.id && o.last_ip === c.last_ip)
                              if (dup) setIpWarning({ target: c, duplicate: dup })
                            }
                          }}
                        >
                          <span
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 5,
                              fontSize: '0.72rem', fontFamily: 'monospace', fontWeight: 600,
                              color: c.ip_status === 'warning' ? (c.last_ip && ipColorMap[c.last_ip]) || '#eab308' : '#475569',
                              cursor: c.ip_status === 'warning' ? 'pointer' : 'default',
                            }}
                          >
                            <span style={{
                              width: 7, height: 7, borderRadius: '50%', flexShrink: 0,
                              background: c.ip_status === 'warning' ? (c.last_ip && ipColorMap[c.last_ip]) || '#eab308' : '#334155',
                            }} />
                            {c.last_ip || '—'}
                          </span>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <span
                            className={`badge ${c.is_active ? 'badge-green' : 'badge-red'}`}
                            style={{ fontSize: '0.68rem', cursor: 'pointer' }}
                            title={c.is_active ? 'Clicca per disabilitare' : 'Clicca per attivare'}
                            onClick={() => setConfirmToggle({ id: c.id, name: c.ragione_sociale || c.name || '', activate: !c.is_active })}
                          >
                            {c.is_active ? 'Attivo' : 'Disabilitato'}
                          </span>
                        </td>
                        <td onClick={(e) => e.stopPropagation()}>
                          <div style={{ position: 'relative' }}>
                            <button
                              className="btn-ghost"
                              style={{ padding: '0.3rem 0.8rem', fontSize: '0.75rem', color: '#94a3b8', borderColor: 'rgba(148,163,184,0.2)', display: 'flex', alignItems: 'center', gap: 5 }}
                              onClick={() => setOpenDropdown(openDropdown === c.id ? null : c.id)}
                            >
                              Azioni <ChevronDown size={12} />
                            </button>
                            {openDropdown === c.id && (
                              <div
                                style={{ position: 'absolute', right: 0, top: '110%', zIndex: 50, background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 10, minWidth: 140, overflow: 'hidden', boxShadow: '0 8px 24px rgba(0,0,0,0.4)' }}
                                onClick={(e) => e.stopPropagation()}
                              >
                                {[
                                  { label: '+1 credito', color: '#f59e0b', action: () => { setConfirmCreditId(c.id); setConfirmCreditStep((c.credits ?? 0) > 0 || c.welcome_bonus_used ? 1 : 0); setOpenDropdown(null) } },
                                  { label: 'Cancella azienda', color: '#ef4444', action: () => { setConfirmDeleteId(c.id); setOpenDropdown(null) } },
                                ].map((item) => (
                                  <button
                                    key={item.label}
                                    onClick={item.action}
                                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '0.6rem 1rem', fontSize: '0.8rem', fontWeight: 600, color: item.color, background: 'none', border: 'none', cursor: 'pointer', borderBottom: '1px solid rgba(255,255,255,0.04)' }}
                                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255,255,255,0.04)')}
                                    onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
                                  >
                                    {item.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
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
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', margin: 0 }}>
                  Utilizzo &amp; Fatturazione ({billing.length} aziende)
                </h3>
                {/* Filters */}
                <div className="flex items-center gap-2 flex-wrap">
                  <input
                    type="text"
                    placeholder="Filtra per azienda..."
                    value={billingFilterCompany}
                    onChange={(e) => setBillingFilterCompany(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.4rem 0.75rem', color: '#f1f5f9', fontSize: '0.8rem', minWidth: 160 }}
                  />
                  <select
                    value={billingFilterMonth}
                    onChange={(e) => setBillingFilterMonth(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.4rem 0.75rem', color: billingFilterMonth ? '#f1f5f9' : '#64748b', fontSize: '0.8rem' }}
                  >
                    <option value="">Tutti i mesi</option>
                    {['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'].map((m, i) => (
                      <option key={m} value={String(i + 1)}>{m}</option>
                    ))}
                  </select>
                  <select
                    value={billingFilterYear}
                    onChange={(e) => setBillingFilterYear(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.4rem 0.75rem', color: billingFilterYear ? '#f1f5f9' : '#64748b', fontSize: '0.8rem' }}
                  >
                    <option value="">Tutti gli anni</option>
                    {[2025, 2026, 2027].map((y) => (
                      <option key={y} value={String(y)}>{y}</option>
                    ))}
                  </select>
                </div>
              </div>

              {(() => {
                const filteredBilling = billing.filter((b) => {
                  if (billingFilterCompany && !(b.name || '').toLowerCase().includes(billingFilterCompany.toLowerCase())) return false
                  if (billingFilterMonth || billingFilterYear) {
                    const payments = b.payments || []
                    const hasMatch = payments.some((p) => {
                      const d = new Date(p.date)
                      if (billingFilterMonth && String(d.getMonth() + 1) !== billingFilterMonth) return false
                      if (billingFilterYear && String(d.getFullYear()) !== billingFilterYear) return false
                      return true
                    })
                    if (!hasMatch) return false
                  }
                  return true
                })

                if (filteredBilling.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                      Nessun dato di fatturazione disponibile
                    </div>
                  )
                }

                // Group all payments by month/year for display
                return (
                  <div className="flex flex-col gap-3">
                    {filteredBilling.map((b) => {
                      let payments = b.payments || []
                      // Apply month/year filter to payments
                      if (billingFilterMonth || billingFilterYear) {
                        payments = payments.filter((p) => {
                          const d = new Date(p.date)
                          if (billingFilterMonth && String(d.getMonth() + 1) !== billingFilterMonth) return false
                          if (billingFilterYear && String(d.getFullYear()) !== billingFilterYear) return false
                          return true
                        })
                      }

                      // Group payments by month
                      const byMonth: Record<string, typeof payments> = {}
                      payments.forEach((p) => {
                        const d = new Date(p.date)
                        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
                        if (!byMonth[key]) byMonth[key] = []
                        byMonth[key].push(p)
                      })
                      const monthKeys = Object.keys(byMonth).sort().reverse()

                      const isOpen = expandedCompany === b.id
                      const totalPaid = b.total_paid ?? 0
                      return (
                        <div key={b.id} className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.08)' }}>
                          {/* Company header row */}
                          <button
                            className="w-full flex items-center justify-between p-4"
                            style={{ background: 'rgba(255,255,255,0.03)', border: 'none', cursor: 'pointer', color: '#f1f5f9' }}
                            onClick={() => setExpandedCompany(isOpen ? null : b.id)}
                          >
                            <div className="flex items-center gap-3">
                              <div style={{ textAlign: 'left' }}>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#f1f5f9' }}>{b.name || '—'}</div>
                                <div style={{ fontSize: '0.75rem', color: '#64748b' }}>{b.email}</div>
                              </div>
                            </div>
                            <div className="flex items-center gap-3 flex-shrink-0">
                              <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '0.78rem', color: '#64748b' }}>
                                  <span style={{ color: '#f59e0b', fontWeight: 600 }}>{b.credits ?? 0}</span> crediti · <span style={{ color: '#22c55e', fontWeight: 600 }}>€{totalPaid.toFixed(2)}</span> totale
                                </div>
                              </div>
                              <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}>{payments.length} pagamenti</span>
                              {isOpen
                                ? <ChevronDown size={15} style={{ color: '#64748b' }} />
                                : <ChevronRight size={15} style={{ color: '#64748b' }} />}
                            </div>
                          </button>

                          {/* Payments list grouped by month */}
                          {isOpen && (
                            <div style={{ padding: '0.5rem 1rem 1rem' }}>
                              {payments.length === 0 ? (
                                <div style={{ fontSize: '0.82rem', color: '#475569', padding: '0.75rem 0' }}>Nessun pagamento registrato</div>
                              ) : (
                                <div className="flex flex-col gap-4">
                                  {monthKeys.map((mk) => {
                                    const [y, m] = mk.split('-')
                                    const monthName = new Date(Number(y), Number(m) - 1, 1).toLocaleString('it-IT', { month: 'long', year: 'numeric' })
                                    return (
                                      <div key={mk}>
                                        <div style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, paddingBottom: 4, borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
                                          {monthName}
                                        </div>
                                        <div className="flex flex-col gap-2">
                                          {byMonth[mk].map((p) => {
                                            const statusColor = p.status === 'approved' ? '#22c55e' : p.status === 'rejected' ? '#ef4444' : '#f59e0b'
                                            const statusLabel = p.status === 'approved' ? 'Approvato' : p.status === 'rejected' ? 'Rifiutato' : 'In attesa'
                                            return (
                                              <div
                                                key={p.id}
                                                className="flex items-center justify-between rounded-lg px-3 py-2.5"
                                                style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}
                                              >
                                                <div className="flex items-center gap-3">
                                                  <div
                                                    style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem',
                                                      background: p.type === 'stripe' ? 'rgba(99,102,241,0.12)' : 'rgba(245,158,11,0.1)',
                                                    }}
                                                  >
                                                    {p.type === 'stripe' ? '💳' : '🏦'}
                                                  </div>
                                                  <div>
                                                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#f1f5f9' }}>
                                                      {p.method_label} · +{p.credits} crediti
                                                    </div>
                                                    <div style={{ fontSize: '0.72rem', color: '#64748b' }}>
                                                      {new Date(p.date).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                                    </div>
                                                  </div>
                                                </div>
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                  <span style={{ fontSize: '0.82rem', fontWeight: 700, color: '#f59e0b' }}>€{p.amount_eur.toFixed(2)}</span>
                                                  <span style={{ fontSize: '0.68rem', fontWeight: 600, color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}40`, borderRadius: 5, padding: '0.15rem 0.45rem' }}>
                                                    {statusLabel}
                                                  </span>
                                                  {p.type === 'bonifico' && p.receipt_id && (
                                                    <button
                                                      className="btn-ghost flex items-center gap-1"
                                                      style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
                                                      onClick={async () => {
                                                        const token = localStorage.getItem('token')
                                                        const res = await fetch(`/admin/bonifico-requests/${p.receipt_id}/receipt`, {
                                                          headers: { Authorization: `Bearer ${token}` },
                                                        })
                                                        if (!res.ok) return
                                                        const blob = await res.blob()
                                                        const url = URL.createObjectURL(blob)
                                                        const a = document.createElement('a')
                                                        a.href = url; a.download = `ricevuta-${p.receipt_id}.pdf`; a.click()
                                                        URL.revokeObjectURL(url)
                                                      }}
                                                    >
                                                      <FileDown size={12} /> Ricevuta
                                                    </button>
                                                  )}
                                                  {p.type === 'bonifico' && !p.receipt_id && (
                                                    <span style={{ fontSize: '0.7rem', color: '#475569' }}>no allegato</span>
                                                  )}
                                                </div>
                                              </div>
                                            )
                                          })}
                                        </div>
                                      </div>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })()}
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
          {tab === 'tickets' && (
            <motion.div
              key="tickets"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="card mt-4"
            >
              <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', marginBottom: '1rem' }}>
                Segnalazioni / Ticket ({tickets.length})
              </h3>

              {tickets.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                  Nessuna segnalazione
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {tickets.map((t) => {
                    const statusColor = t.status === 'risolto' ? '#22c55e' : t.status === 'in_elaborazione' ? '#eab308' : '#94a3b8'
                    const statusLabel = t.status === 'risolto' ? 'Risolto' : t.status === 'in_elaborazione' ? 'In elaborazione' : 'Aperto'
                    return (
                      <div
                        key={t.id}
                        className="rounded-xl p-4"
                        style={{ background: 'rgba(255,255,255,0.03)', border: `1px solid ${t.status === 'risolto' ? 'rgba(34,197,94,0.15)' : t.status === 'in_elaborazione' ? 'rgba(234,179,8,0.2)' : 'rgba(255,255,255,0.07)'}` }}
                      >
                        <div className="flex items-start justify-between gap-4 flex-wrap">
                          <div style={{ flex: 1 }}>
                            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                              <span style={{ fontSize: '0.72rem', color: '#475569', fontWeight: 600 }}>#{t.id}</span>
                              <span style={{ fontSize: '0.8rem', color: '#f1f5f9', fontWeight: 700 }}>{t.subject}</span>
                              <span style={{ fontSize: '0.68rem', fontWeight: 600, color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}40`, borderRadius: 5, padding: '0.15rem 0.45rem' }}>
                                {statusLabel}
                              </span>
                            </div>
                            <div className="flex items-center gap-3 mb-2 flex-wrap">
                              <span style={{ fontSize: '0.78rem', color: '#64748b' }}>{t.company_name || '—'}</span>
                              <span style={{ fontSize: '0.72rem', color: '#475569' }}>{t.company_email}</span>
                              <span style={{ fontSize: '0.72rem', color: '#475569' }}>
                                {new Date(t.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
                              </span>
                            </div>
                            <p style={{ fontSize: '0.82rem', color: '#94a3b8', margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{t.message}</p>
                            <a
                              href={`mailto:${t.company_email}?subject=Re:%20%23${t.id}%20${encodeURIComponent(t.subject)}&body=Gentile%20${encodeURIComponent(t.company_name || '')}%2C%0A%0A`}
                              style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginTop: 8, fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600, textDecoration: 'none', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '0.25rem 0.6rem' }}
                            >
                              ✉ Rispondi via email
                            </a>
                          </div>
                          <div className="flex flex-col gap-1.5 flex-shrink-0">
                            {t.status !== 'in_elaborazione' && (
                              <button
                                className="btn-ghost"
                                disabled={t.status === 'risolto'}
                                style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', color: t.status === 'risolto' ? '#475569' : '#eab308', borderColor: t.status === 'risolto' ? 'rgba(71,85,105,0.3)' : 'rgba(234,179,8,0.3)', whiteSpace: 'nowrap', opacity: t.status === 'risolto' ? 0.45 : 1, cursor: t.status === 'risolto' ? 'not-allowed' : 'pointer' }}
                                onClick={() => t.status !== 'risolto' && updateTicketStatus(t.id, 'in_elaborazione')}
                              >
                                In elaborazione
                              </button>
                            )}
                            {t.status !== 'risolto' && (
                              <button
                                className="btn-ghost"
                                style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', color: '#22c55e', borderColor: 'rgba(34,197,94,0.3)', whiteSpace: 'nowrap' }}
                                onClick={() => updateTicketStatus(t.id, 'risolto')}
                              >
                                <Check size={12} /> Risolto
                              </button>
                            )}
                            {t.status !== 'aperto' && (
                              <button
                                className="btn-ghost"
                                style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', color: '#94a3b8', borderColor: 'rgba(148,163,184,0.2)', whiteSpace: 'nowrap' }}
                                onClick={() => updateTicketStatus(t.id, 'aperto')}
                              >
                                Riapri
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
                <div className="flex flex-col gap-2">
                  {uploads.map((company) => {
                    const isCompanyOpen = expandedCompany === company.company_id
                    const totalElab = company.jobs.length
                    const totalFiles = company.jobs.reduce((s, j) => s + j.files.length, 0)
                    return (
                      <div key={company.company_id} style={{ borderRadius: 12, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>

                        {/* ── Livello 1: Cartella azienda ── */}
                        <button
                          className="w-full flex items-center justify-between px-4 py-3"
                          style={{ background: 'rgba(245,158,11,0.06)', border: 'none', cursor: 'pointer', color: '#f1f5f9' }}
                          onClick={() => setExpandedCompany(isCompanyOpen ? null : company.company_id)}
                        >
                          <div className="flex items-center gap-3">
                            <span style={{ fontSize: '1.1rem' }}>{isCompanyOpen ? '📂' : '📁'}</span>
                            <div style={{ textAlign: 'left' }}>
                              <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#f59e0b' }}>{company.company_name}</div>
                              <div style={{ fontSize: '0.72rem', color: '#64748b' }}>{company.company_email}</div>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span style={{ fontSize: '0.7rem', color: '#64748b', background: 'rgba(255,255,255,0.06)', borderRadius: 6, padding: '2px 8px' }}>
                              {totalElab} elabor. · {totalFiles} file
                            </span>
                            {isCompanyOpen
                              ? <ChevronDown size={14} style={{ color: '#64748b' }} />
                              : <ChevronRight size={14} style={{ color: '#64748b' }} />
                            }
                          </div>
                        </button>

                        {/* ── Livello 2: Cartelle elaborazioni ── */}
                        {isCompanyOpen && (
                          <div style={{ padding: '6px 12px 12px 28px', background: 'rgba(0,0,0,0.15)' }}>
                            {company.jobs.length === 0 && (
                              <div style={{ fontSize: '0.8rem', color: '#475569', padding: '0.5rem 0' }}>Nessuna elaborazione</div>
                            )}
                            {company.jobs.map((job) => {
                              const isJobOpen = expandedJob === job.job_id
                              const jobLabel = job.tif_filename
                                ? job.tif_filename.replace(/\.[^.]+$/, '')
                                : `Elaborazione ${new Date(job.created_at).toLocaleDateString('it-IT')}`
                              return (
                                <div key={job.job_id} style={{ marginBottom: 6 }}>

                                  {/* ── Livello 2 header: cartella elaborazione ── */}
                                  <button
                                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg"
                                    style={{ background: isJobOpen ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)', cursor: 'pointer', color: '#f1f5f9' }}
                                    onClick={() => setExpandedJob(isJobOpen ? null : job.job_id)}
                                  >
                                    <div className="flex items-center gap-2">
                                      <span style={{ fontSize: '1rem' }}>{isJobOpen ? '📂' : '📁'}</span>
                                      <div style={{ textAlign: 'left' }}>
                                        <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#e2e8f0' }}>{jobLabel}</div>
                                        <div style={{ fontSize: '0.7rem', color: '#64748b' }}>
                                          {new Date(job.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' })}
                                          {' · '}{job.files.length} file
                                        </div>
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className={`badge ${job.status === 'completato' ? 'badge-green' : job.status === 'errore' ? 'badge-red' : 'badge-amber'}`} style={{ fontSize: '0.62rem' }}>
                                        {job.status}
                                      </span>
                                      {isJobOpen
                                        ? <ChevronDown size={13} style={{ color: '#64748b' }} />
                                        : <ChevronRight size={13} style={{ color: '#64748b' }} />
                                      }
                                    </div>
                                  </button>

                                  {/* ── Livello 3: file dentro la cartella elaborazione ── */}
                                  {isJobOpen && (
                                    <div style={{ paddingLeft: 28, paddingTop: 4 }}>
                                      {job.files.length === 0 ? (
                                        <div style={{ fontSize: '0.78rem', color: '#475569', padding: '6px 0' }}>Nessun file trovato</div>
                                      ) : (
                                        <div className="flex flex-col gap-1">
                                          {job.files.map((file) => {
                                            const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
                                            const icon = ext === 'pdf' ? '📄' : ext === 'tif' || ext === 'tiff' ? '🗺️' : ext === 'jpg' || ext === 'png' ? '🖼️' : '📋'
                                            return (
                                              <div
                                                key={file.name}
                                                className="flex items-center justify-between rounded-lg px-3 py-1.5"
                                                style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                                              >
                                                <div className="flex items-center gap-2">
                                                  <span style={{ fontSize: '0.9rem' }}>{icon}</span>
                                                  <span style={{ fontSize: '0.78rem', color: '#cbd5e1', fontWeight: 500 }}>{file.name}</span>
                                                  <span style={{ fontSize: '0.68rem', color: '#475569' }}>{file.size_mb} MB</span>
                                                </div>
                                                <button
                                                  onClick={async () => {
                                                    const res = await fetch(`/admin/jobs/${job.job_id}/files/${encodeURIComponent(file.name)}`, {
                                                      credentials: 'include',
                                                    })
                                                    if (!res.ok) return
                                                    const blob = await res.blob()
                                                    const url = URL.createObjectURL(blob)
                                                    const a = document.createElement('a')
                                                    a.href = url; a.download = file.name; a.click()
                                                    URL.revokeObjectURL(url)
                                                  }}
                                                  className="btn-ghost flex items-center gap-1"
                                                  style={{ fontSize: '0.72rem', padding: '0.25rem 0.6rem' }}
                                                >
                                                  <FileDown size={12} /> Scarica
                                                </button>
                                              </div>
                                            )
                                          })}
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
                  Clienti Enterprise
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

              {(() => {
                const logs = enterpriseLogs.length > 0 ? enterpriseLogs : FAKE_ENTERPRISE
                const isFake = enterpriseLogs.length === 0
                return (
                  <>
                    {isFake && (
                      <div className="rounded-xl px-4 py-2 mb-4" style={{ background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.15)', fontSize: '0.78rem', color: '#f59e0b' }}>
                        Dati di esempio — nessun cliente Enterprise reale ancora registrato
                      </div>
                    )}
                    <div className="flex flex-col gap-2">
                      {logs.map((l) => (
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
                  </>
                )
              })()}
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

      {/* Confirm add credit modal */}
      <AnimatePresence>
        {confirmCreditId && (
          <div
            className="modal-overlay"
            onClick={() => { setConfirmCreditId(null); setConfirmCreditStep(0) }}
            style={{ background: confirmCreditStep >= 1 ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.6)' }}
          >
            <motion.div
              key={confirmCreditStep}
              initial={{ opacity: 0, scale: 0.7, rotate: confirmCreditStep >= 1 ? -4 : 0 }}
              animate={{
                opacity: 1,
                scale: 1,
                rotate: 0,
                x: confirmCreditStep >= 2 ? [0, -6, 6, -4, 4, 0] : 0,
              }}
              transition={{
                duration: 0.35,
                x: { duration: 0.4, delay: 0.1 },
              }}
              exit={{ opacity: 0, scale: 0.8 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: confirmCreditStep === 0 ? '#0d1117' : confirmCreditStep === 1 ? '#0f0a00' : confirmCreditStep === 2 ? '#110000' : '#0d0000',
                border: confirmCreditStep === 0
                  ? '1px solid rgba(245,158,11,0.3)'
                  : confirmCreditStep === 1
                  ? '2px solid rgba(245,158,11,0.6)'
                  : confirmCreditStep === 2
                  ? '2px solid rgba(239,68,68,0.7)'
                  : '3px solid #ef4444',
                borderRadius: confirmCreditStep >= 3 ? 12 : 20,
                padding: '2rem',
                maxWidth: 400,
                width: '90%',
                textAlign: 'center',
                boxShadow: confirmCreditStep >= 2
                  ? `0 0 ${confirmCreditStep * 20}px rgba(239,68,68,${confirmCreditStep * 0.15})`
                  : 'none',
                position: 'relative',
                overflow: 'hidden',
              }}
            >
              {/* Alarm stripes background for step 3 */}
              {confirmCreditStep === 3 && (
                <div style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
                  background: 'repeating-linear-gradient(45deg, rgba(239,68,68,0.04) 0px, rgba(239,68,68,0.04) 10px, transparent 10px, transparent 20px)',
                }} />
              )}

              <div style={{ position: 'relative', zIndex: 1 }}>
                {/* Alarm icon */}
                {confirmCreditStep === 0 ? (
                  <div style={{ fontSize: 42, marginBottom: 12 }}>🎁</div>
                ) : (
                  <motion.div
                    animate={confirmCreditStep >= 2 ? { rotate: [0, -15, 15, -10, 10, 0] } : {}}
                    transition={{ duration: 0.5, repeat: confirmCreditStep >= 2 ? Infinity : 0, repeatDelay: 1.2 }}
                    style={{ marginBottom: 12, display: 'inline-block' }}
                  >
                    {/* SVG alarm bell */}
                    <svg width={confirmCreditStep >= 3 ? 64 : 52} height={confirmCreditStep >= 3 ? 64 : 52} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="32" cy="32" r="30"
                        fill={confirmCreditStep === 1 ? 'rgba(245,158,11,0.12)' : confirmCreditStep === 2 ? 'rgba(239,68,68,0.15)' : 'rgba(239,68,68,0.25)'}
                        stroke={confirmCreditStep === 1 ? '#f59e0b' : '#ef4444'}
                        strokeWidth={confirmCreditStep >= 3 ? 3 : 2}
                      />
                      {/* Bell body */}
                      <path d="M32 14c-7.7 0-14 6.3-14 14v8l-3 4h34l-3-4v-8c0-7.7-6.3-14-14-14z"
                        fill={confirmCreditStep === 1 ? '#f59e0b' : '#ef4444'}
                        opacity="0.9"
                      />
                      {/* Bell clapper */}
                      <circle cx="32" cy="46" r="3"
                        fill={confirmCreditStep === 1 ? '#f59e0b' : '#ef4444'}
                      />
                      {/* Exclamation */}
                      <text x="32" y="38" textAnchor="middle" fill="white" fontSize="14" fontWeight="900">!</text>
                      {/* Vibration lines */}
                      {confirmCreditStep >= 2 && (
                        <>
                          <path d="M12 24 Q8 28 12 32" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
                          <path d="M52 24 Q56 28 52 32" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" opacity="0.7"/>
                        </>
                      )}
                    </svg>
                  </motion.div>
                )}

                {/* Flashing dot for step 3 */}
                {confirmCreditStep === 3 && (
                  <motion.div
                    animate={{ opacity: [1, 0, 1] }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                    style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', margin: '0 auto 12px' }}
                  />
                )}

                <h3 style={{
                  color: confirmCreditStep === 0 ? '#f1f5f9' : confirmCreditStep === 1 ? '#f59e0b' : '#ef4444',
                  fontWeight: 900,
                  fontSize: confirmCreditStep >= 2 ? '1.25rem' : '1.05rem',
                  marginBottom: 8,
                  letterSpacing: confirmCreditStep >= 3 ? '0.05em' : 'normal',
                  textTransform: confirmCreditStep >= 3 ? 'uppercase' : 'none',
                }}>
                  {confirmCreditStep === 0 && 'Regalare 1 credito?'}
                  {confirmCreditStep === 1 && 'Sicuro?'}
                  {confirmCreditStep === 2 && 'Sicuro sicuro?'}
                  {confirmCreditStep === 3 && '⚠ Sicuro sicuro sicuro? ⚠'}
                </h3>

                <p style={{
                  color: confirmCreditStep >= 2 ? '#fca5a5' : '#64748b',
                  fontSize: '0.875rem',
                  lineHeight: 1.6,
                  marginBottom: 24,
                }}>
                  {confirmCreditStep === 0 && "Verrà aggiunto 1 credito all'azienda selezionata."}
                  {confirmCreditStep === 1 && 'Questa azienda ha già dei crediti. Vuoi davvero aggiungerne un altro?'}
                  {confirmCreditStep === 2 && 'Stai regalando un credito extra a un cliente già attivo.'}
                  {confirmCreditStep === 3 && 'ULTIMA CHANCE. Questa azione è irreversibile. Sei proprio sicuro?'}
                </p>

                <div className="flex gap-3 justify-center">
                  <button
                    className="btn-ghost"
                    style={{ padding: '0.6rem 1.4rem', color: '#94a3b8' }}
                    onClick={() => { setConfirmCreditId(null); setConfirmCreditStep(0) }}
                  >
                    Annulla
                  </button>
                  <button
                    style={{
                      padding: '0.6rem 1.4rem',
                      fontWeight: 700,
                      borderRadius: 10,
                      border: `2px solid ${confirmCreditStep >= 2 ? '#ef4444' : 'rgba(245,158,11,0.5)'}`,
                      background: confirmCreditStep >= 3 ? 'rgba(239,68,68,0.15)' : 'transparent',
                      color: confirmCreditStep >= 2 ? '#ef4444' : '#f59e0b',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      if (confirmCreditStep < 3) {
                        setConfirmCreditStep(confirmCreditStep + 1)
                      } else {
                        addCredit(confirmCreditId)
                        setConfirmCreditId(null)
                        setConfirmCreditStep(0)
                      }
                    }}
                  >
                    {confirmCreditStep < 3 ? 'Sì' : 'Sì, aggiungi'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* IP Warning modal */}
      <AnimatePresence>
        {ipWarning && (
          <div className="modal-overlay" onClick={() => setIpWarning(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              style={{ background: '#0d1117', border: '1px solid rgba(234,179,8,0.35)', borderRadius: 20, padding: '2rem', maxWidth: 420, width: '90%' }}
            >
              <div style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>⚠️</div>
                <div style={{ color: '#eab308', fontWeight: 800, fontSize: '1.05rem', marginBottom: 6 }}>Sospetto doppia azienda — stesso IP</div>
                <div style={{ color: '#64748b', fontSize: '0.82rem' }}>Queste due aziende si sono registrate dallo stesso indirizzo IP</div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: '1.5rem' }}>
                {[ipWarning.target, ipWarning.duplicate].map((c) => (
                  <div key={c.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                    <div>
                      <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.9rem' }}>{c.ragione_sociale || c.name}</div>
                      <div style={{ color: '#64748b', fontSize: '0.78rem' }}>{c.email} · IP: <span style={{ fontFamily: 'monospace', color: '#eab308' }}>{c.last_ip}</span></div>
                    </div>
                    <button
                      style={{ flexShrink: 0, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 8, padding: '0.45rem 0.9rem', color: '#ef4444', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap' }}
                      onClick={async () => {
                        await apiFetch(`/admin/companies/${c.id}/deactivate`, { method: 'POST' })
                        setCompanies(prev => prev.map(co => co.id === c.id ? { ...co, is_active: false } : co))
                        setMsg(`Azienda "${c.ragione_sociale || c.name}" bloccata`)
                        setTimeout(() => setMsg(''), 3000)
                        setIpWarning(null)
                      }}
                    >
                      🚫 Blocca
                    </button>
                  </div>
                ))}
              </div>

              <button
                style={{ width: '100%', background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 10, padding: '0.75rem', color: '#22c55e', fontWeight: 700, fontSize: '0.88rem', cursor: 'pointer' }}
                onClick={() => setIpWarning(null)}
              >
                ✓ Accetta entrambe
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirm toggle (enable/disable) modal */}
      <AnimatePresence>
        {confirmToggle && (
          <div className="modal-overlay" onClick={() => setConfirmToggle(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#0d1117',
                border: `1px solid ${confirmToggle.activate ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}`,
                borderRadius: 20,
                padding: '2rem',
                maxWidth: 380,
                width: '90%',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 12 }}>{confirmToggle.activate ? '✅' : '🔒'}</div>
              <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1.05rem', marginBottom: 8 }}>
                {confirmToggle.activate ? 'Attivare l\'azienda?' : 'Disabilitare l\'azienda?'}
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.875rem', lineHeight: 1.6, marginBottom: 24 }}>
                {confirmToggle.activate
                  ? `Vuoi veramente attivare "${confirmToggle.name}"? Potrà di nuovo accedere e usare il servizio.`
                  : `Vuoi veramente disabilitare "${confirmToggle.name}"? Non potrà più accedere fino a riattivazione.`}
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  className="btn-ghost"
                  style={{ padding: '0.6rem 1.4rem', color: '#94a3b8' }}
                  onClick={() => setConfirmToggle(null)}
                >
                  Annulla
                </button>
                <button
                  className="btn-ghost"
                  style={{
                    padding: '0.6rem 1.4rem',
                    color: confirmToggle.activate ? '#22c55e' : '#ef4444',
                    borderColor: confirmToggle.activate ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)',
                    fontWeight: 700,
                  }}
                  onClick={() => {
                    toggleCompany(confirmToggle.id, confirmToggle.activate)
                    setConfirmToggle(null)
                  }}
                >
                  {confirmToggle.activate ? 'Sì, attiva' : 'Sì, disabilita'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Confirm delete modal */}
      <AnimatePresence>
        {confirmDeleteId && (
          <div className="modal-overlay" onClick={() => setConfirmDeleteId(null)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={(e) => e.stopPropagation()}
              style={{
                background: '#0d1117',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 20,
                padding: '2rem',
                maxWidth: 380,
                width: '90%',
                textAlign: 'center',
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 12 }}>🗑️</div>
              <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1.05rem', marginBottom: 8 }}>
                Eliminare l'azienda?
              </h3>
              <p style={{ color: '#64748b', fontSize: '0.875rem', lineHeight: 1.6, marginBottom: 24 }}>
                L'azienda verrà disattivata e non potrà più accedere. L'operazione è reversibile dal database.
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  className="btn-ghost"
                  style={{ padding: '0.6rem 1.4rem', color: '#94a3b8' }}
                  onClick={() => setConfirmDeleteId(null)}
                >
                  Annulla
                </button>
                <button
                  className="btn-ghost"
                  style={{ padding: '0.6rem 1.4rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.4)', fontWeight: 700 }}
                  onClick={() => deleteCompany(confirmDeleteId)}
                >
                  Sì, elimina
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
