import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, LogOut, Users, BarChart2, Star,
  Check, X, TrendingUp, Building2, Euro,
  FolderOpen, FileDown, ChevronRight, ChevronDown, MessageSquare, Zap, Bell,
} from 'lucide-react'
import { apiFetch } from '../api'

// ── Types ──────────────────────────────────────────────────────────────────
interface Stats {
  active_companies?: number
  total_panels_detected?: number
  total_revenue_eur?: number
  revenue_month_eur?: number
  gpu_cost_month_eur?: number
  total_gpu_cost_eur?: number
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
  subscription_active?: boolean
  subscription_plan?: string | null
  subscription_start_date?: string | null
  subscription_end_date?: string | null
  gpu_cost_eur?: number
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
  vat_number?: string
  credits?: number
  jobs_completed?: number
  total_paid?: number
  payments?: BillingPayment[]
}

interface AdminTicketMsg {
  id: number
  sender: string
  text: string
  created_at: string
}

interface AdminTicketDetail {
  id: number
  subject: string
  message: string
  status: string
  created_at: string
  company_name?: string
  company_email?: string
  messages: AdminTicketMsg[]
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
  status: 'in_elaborazione' | 'risolto'
  created_at: string
}


// ── Animated counter ───────────────────────────────────────────────────────
function AnimatedNumber({ value, prefix = '', suffix = '', decimals = 0 }: { value: number; prefix?: string; suffix?: string; decimals?: number }) {
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
      const current = start + (end - start) * eased
      setDisplay(decimals > 0 ? current : Math.round(current))
      if (progress < 1) raf.current = requestAnimationFrame(step)
    }

    raf.current = requestAnimationFrame(step)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [value, decimals])

  return <>{prefix}{decimals > 0 ? display.toFixed(decimals) : display.toLocaleString('it-IT')}{suffix}</>
}

// ── Company Detail Modal ───────────────────────────────────────────────────
interface SupportTicket {
  id: number
  subject: string
  message: string
  created_at: string
}

interface HistoryPoint { label: string; count: number }

function CompanyModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const [tickets, setTickets] = useState<SupportTicket[]>([])
  const [history, setHistory] = useState<HistoryPoint[]>([])

  useEffect(() => {
    apiFetch(`/sys-ctrl/companies/${company.id}/tickets`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setTickets(Array.isArray(d) ? d : []))
      .catch(() => {})
    apiFetch(`/sys-ctrl/companies/${company.id}/history`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setHistory(Array.isArray(d) ? d : []))
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
            { label: 'Tipologia cliente', value: 'Normal' },
            { label: 'Ragione sociale', value: company.ragione_sociale || '—' },
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

        {/* Grafico elaborazioni mensili */}
        {history.length > 0 && history.some(h => h.count > 0) && (() => {
          const maxVal = Math.max(...history.map(h => h.count), 1)
          const chartH = 60
          const barW = 100 / history.length
          return (
            <div style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
              <div style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                Elaborazioni ultimi 12 mesi
              </div>
              <svg width="100%" height={chartH + 20} style={{ overflow: 'visible' }}>
                {history.map((h, i) => {
                  const barH = h.count === 0 ? 2 : Math.max(4, (h.count / maxVal) * chartH)
                  const x = i * barW + barW * 0.15
                  const w = barW * 0.7
                  const y = chartH - barH
                  return (
                    <g key={h.label}>
                      <rect
                        x={`${x}%`} y={y} width={`${w}%`} height={barH}
                        rx={3}
                        fill={h.count > 0 ? '#f59e0b' : 'rgba(255,255,255,0.06)'}
                        opacity={h.count > 0 ? 0.85 : 1}
                      />
                      {h.count > 0 && (
                        <text x={`${x + w / 2}%`} y={y - 3} textAnchor="middle" fill="#f1f5f9" fontSize={9} fontWeight={700}>
                          {h.count}
                        </text>
                      )}
                      <text x={`${x + w / 2}%`} y={chartH + 14} textAnchor="middle" fill="#475569" fontSize={8}>
                        {h.label.slice(0, 3)}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
          )
        })()}

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
  const [tab, setTab] = useState<'companies' | 'billing' | 'reviews' | 'tickets' | 'uploads' | 'gpu'>('companies')

  const [stats, setStats] = useState<Stats>({})
  const [companies, setCompanies] = useState<Company[]>([])
  const [billing, setBilling] = useState<BillingItem[]>([])
  const [adminReviews, setAdminReviews] = useState<ReviewItem[]>([])

  const [uploads, setUploads] = useState<UploadCompany[]>([])

  interface GpuJobDetail {
    job_id: string
    created_at: string
    seconds: number
    cost_eur: number
  }
  interface GpuCostItem {
    company_id?: number
    company_name: string
    company_email: string
    job_count: number
    total_seconds: number
    cost_eur: number
    jobs: GpuJobDetail[]
  }
  const [gpuCosts, setGpuCosts] = useState<GpuCostItem[]>([])
  const [showPLChart, setShowPLChart] = useState(false)
  const [expandedGpuCompany, setExpandedGpuCompany] = useState<string | null>(null)
  const [gpuMonthFilter, setGpuMonthFilter] = useState<string>('all')
  const [supabasePlan, setSupabasePlan] = useState<'free' | 'pro'>('free')
  const [domainCostActive, setDomainCostActive] = useState(true)
  const [domainCostEur, setDomainCostEur] = useState(1.00)
  const [editingDomainCost, setEditingDomainCost] = useState(false)
  const [domainCostInput, setDomainCostInput] = useState('1.00')
  const [startDate, setStartDate] = useState(() => {
    const saved = localStorage.getItem('solardino_start_date')
    return saved || '2025-01-01'
  })
  const [taxRate, setTaxRate] = useState(22)
  const [editingTaxRate, setEditingTaxRate] = useState(false)
  const [monthlyChartData, setMonthlyChartData] = useState<Array<{month:string;label:string;revenue_eur:number;gpu_cost_eur:number}>>([])
  const [chartLoading, setChartLoading] = useState(false)
  const [storageInfo, setStorageInfo] = useState<{ used_mb: number; file_count: number } | null>(null)
  const [dbInfo, setDbInfo] = useState<{ used_mb: number } | null>(null)
  const [cleanupLoading, setCleanupLoading] = useState(false)
  const [cleanupMsg, setCleanupMsg] = useState('')
  const [expandedCompany, setExpandedCompany] = useState<number | null>(null)
  const [expandedJob, setExpandedJob] = useState<string | null>(null)

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
  const [adminNotifs, setAdminNotifs] = useState<{id:number,title:string,message:string,is_read:boolean,created_at:string}[]>([])
  const [showBellDropdown, setShowBellDropdown] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  // Admin ticket chat modal
  const [adminTicketDetail, setAdminTicketDetail] = useState<AdminTicketDetail | null>(null)
  const [adminReplyText, setAdminReplyText] = useState('')
  const [adminReplyLoading, setAdminReplyLoading] = useState(false)
  const [adminTicketSubTab, setAdminTicketSubTab] = useState<'aperte' | 'chiuse'>('aperte')


  // Billing filters
  const [billingFilterCompany, setBillingFilterCompany] = useState('')
  const [billingFilterMonth, setBillingFilterMonth] = useState('')
  const [billingFilterYear, setBillingFilterYear] = useState('')

  // Uploads filters
  const [uploadsFilterCompany, setUploadsFilterCompany] = useState('')
  const [uploadsFilterMonth, setUploadsFilterMonth] = useState('')
  const [uploadsFilterYear, setUploadsFilterYear] = useState('')

  // Reviews filters
  const [reviewsFilterMonth, setReviewsFilterMonth] = useState('')
  const [reviewsFilterYear, setReviewsFilterYear] = useState('')

  // Tickets filters
  const [ticketsFilterMonth, setTicketsFilterMonth] = useState('')
  const [ticketsFilterYear, setTicketsFilterYear] = useState('')

  // Chiudi dropdown al click fuori
  useEffect(() => {
    if (!openDropdown) return
    const close = () => setOpenDropdown(null)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [openDropdown])

  // Chiudi campanella al click fuori
  useEffect(() => {
    if (!showBellDropdown) return
    const close = (e: MouseEvent) => {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) setShowBellDropdown(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [showBellDropdown])

  // ── Load data ────────────────────────────────────────────────────────
  function loadData() {
    apiFetch('/sys-ctrl/stats').then((r) => r.ok ? r.json() : null).then((d) => { if (d) setStats(d) }).catch(() => {})
    apiFetch('/sys-ctrl/companies').then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d) return
      setCompanies(Array.isArray(d) ? d : d.companies || [])
    }).catch(() => {})
    apiFetch('/sys-ctrl/billing').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) setBilling(Array.isArray(d) ? d : d.billing || [])
    }).catch(() => {})
    apiFetch('/sys-ctrl/reviews').then((r) => r.ok ? r.json() : null).then((d) => {
      if (!d) return
      const arr = Array.isArray(d) ? d : d.reviews || []
      setAdminReviews(arr)
      setPendingReviews(arr.filter((r: ReviewItem) => r.status !== 'approved' && r.status !== 'approvata' && r.status !== 'rejected').length)
    }).catch(() => {})
    apiFetch('/sys-ctrl/uploads').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) setUploads(Array.isArray(d) ? d : [])
    }).catch(() => {})
    apiFetch('/sys-ctrl/gpu-costs').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) setGpuCosts(Array.isArray(d) ? d : [])
    }).catch(() => {})
    apiFetch('/sys-ctrl/supabase-storage').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) setStorageInfo(d)
    }).catch(() => {})
    apiFetch('/sys-ctrl/db-size').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) setDbInfo(d)
    }).catch(() => {})
    apiFetch('/sys-ctrl/tickets').then((r) => r.ok ? r.json() : null).then((d) => {
      if (d) {
        const arr = Array.isArray(d) ? d : []
        setTickets(arr)
        setPendingTickets(arr.filter((t: AdminTicket) => t.status === 'in_elaborazione').length)
      }
    }).catch(() => {})
    apiFetch('/auth/notifications').then((r) => r.ok ? r.json() : null).then((d) => {
      if (Array.isArray(d)) setAdminNotifs(d.filter((n: {title:string}) => n.title === '🆕 Nuova registrazione'))
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
    const path = activate ? `/sys-ctrl/companies/${id}/activate` : `/sys-ctrl/companies/${id}/deactivate`
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
      const res = await apiFetch(`/sys-ctrl/companies/${id}/add-credit`, { method: 'POST' })
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
      const res = await apiFetch(`/sys-ctrl/companies/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setCompanies((prev) => prev.filter((c) => c.id !== id))
        setMsg('Azienda eliminata')
        setTimeout(() => setMsg(''), 3000)
        // Reload from server to keep state consistent
        apiFetch('/sys-ctrl/companies').then((r) => r.ok ? r.json() : null).then((d) => {
          if (d) setCompanies(Array.isArray(d) ? d : d.companies || [])
        }).catch(() => {})
      }
    } catch { }
    setConfirmDeleteId(null)
  }

  async function handleReview(id: string, action: 'approve' | 'reject') {
    try {
      const res = await apiFetch(`/sys-ctrl/reviews/${id}/${action}`, { method: 'POST' })
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
      const res = await apiFetch(`/sys-ctrl/reviews/${id}`, { method: 'DELETE' })
      if (res.ok) {
        setAdminReviews((prev) => prev.filter((r) => r.id !== id))
        setMsg('Recensione eliminata')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
  }


  async function updateTicketStatus(id: number, status: 'in_elaborazione' | 'risolto') {
    try {
      const res = await apiFetch(`/sys-ctrl/tickets/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (res.ok) {
        setTickets((prev) => prev.map((t) => t.id === id ? { ...t, status } : t))
        if (adminTicketDetail?.id === id) setAdminTicketDetail((prev) => prev ? { ...prev, status } : prev)
        setPendingTickets(() => tickets.filter((t) => (t.id === id ? status : t.status) === 'in_elaborazione').length)
        setMsg('Stato aggiornato')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
  }

  async function openAdminTicket(ticketId: number) {
    try {
      const res = await apiFetch(`/sys-ctrl/tickets/${ticketId}`)
      if (res.ok) {
        const d = await res.json()
        setAdminTicketDetail(d)
        setAdminReplyText('')
      }
    } catch { }
  }

  async function sendAdminReply() {
    if (!adminTicketDetail || !adminReplyText.trim()) return
    setAdminReplyLoading(true)
    try {
      const res = await apiFetch(`/sys-ctrl/tickets/${adminTicketDetail.id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reply: adminReplyText.trim() }),
      })
      if (res.ok) {
        const newMsg: AdminTicketMsg = { id: Date.now(), sender: 'admin', text: adminReplyText.trim(), created_at: new Date().toISOString() }
        setAdminTicketDetail((prev) => prev ? { ...prev, status: 'in_elaborazione', messages: [...prev.messages, newMsg] } : prev)
        setTickets((prev) => prev.map((t) => t.id === adminTicketDetail.id ? { ...t, status: 'in_elaborazione' } : t))
        setAdminReplyText('')
        setMsg('Risposta inviata al cliente')
        setTimeout(() => setMsg(''), 3000)
      }
    } catch { }
    setAdminReplyLoading(false)
  }

  async function loadProfitChart() {
    setShowPLChart(true)
    if (monthlyChartData.length === 0) {
      setChartLoading(true)
      try {
        const r = await apiFetch('/sys-ctrl/monthly-summary')
        if (r.ok) setMonthlyChartData(await r.json())
      } catch {}
      setChartLoading(false)
    }
  }

  const cardAnim = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }
  const containerAnim = { hidden: {}, show: { transition: { staggerChildren: 0.07 } } }

  const FIXED_MONTHLY_EUR  = (domainCostActive ? domainCostEur : 0.00) + 0.00 + (supabasePlan === 'pro' ? 23.00 : 0)
  const gpuCostMonth      = stats.gpu_cost_month_eur || 0
  const totalCostMonth    = gpuCostMonth + FIXED_MONTHLY_EUR

  // P&L mensile — tutto sullo stesso orizzonte temporale (mese corrente)
  const fatturatoLordo   = stats.revenue_month_eur || 0
  const fatturatoNetto   = fatturatoLordo * (1 - taxRate / 100)
  const utile            = fatturatoNetto - totalCostMonth

  const totalGpuAllTime  = stats.total_gpu_cost_eur || 0
  const mesiDallInizio   = Math.max(1, Math.round((Date.now() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24 * 30.44)))
  const speseDallInizio  = totalGpuAllTime + (mesiDallInizio * FIXED_MONTHLY_EUR)

  // GPU table: available months + filtered rows
  const gpuMonths: string[] = Array.from(new Set(
    gpuCosts.flatMap(r => (r.jobs || []).map(j => j.created_at.slice(0, 7)))
  )).sort().reverse()

  const filteredGpuCosts = gpuCosts.map(r => {
    const jobs = gpuMonthFilter === 'all' ? (r.jobs || []) : (r.jobs || []).filter(j => j.created_at.slice(0, 7) === gpuMonthFilter)
    const total_seconds = jobs.reduce((a, j) => a + j.seconds, 0)
    const cost_eur = jobs.reduce((a, j) => a + j.cost_eur, 0)
    return { ...r, jobs, job_count: jobs.length, total_seconds, cost_eur }
  }).filter(r => r.job_count > 0)

  const statCards = [
    { icon: <Building2 size={18} />, label: 'Aziende attive',  value: stats.active_companies  || 0, prefix: '' },
    { icon: <Euro size={18} />,      label: 'Fatturato totale', value: stats.total_revenue_eur || 0, prefix: '€' },
  ]

  const costCards = [
    { icon: <Euro size={18} />, label: 'Spese totali ultimo mese', value: totalCostMonth,  prefix: '€', decimals: 4, sub: `GPU €${gpuCostMonth.toFixed(4)} + fissi €${FIXED_MONTHLY_EUR.toFixed(2)}` },
    { icon: <Euro size={18} />, label: 'Spese dall\'inizio',       value: speseDallInizio, prefix: '€', decimals: 4, sub: `GPU €${totalGpuAllTime.toFixed(4)} + fissi €${(mesiDallInizio * FIXED_MONTHLY_EUR).toFixed(2)} (${mesiDallInizio} mes${mesiDallInizio === 1 ? 'e' : 'i'})` },
  ]

  const plCards = [
    {
      icon: <TrendingUp size={18} />,
      label: 'Fatturato lordo (mese)',
      value: fatturatoLordo,
      prefix: '€',
      decimals: 2,
      sub: 'entrate mese corrente',
      color: '#f59e0b',
      editTax: false,
    },
    {
      icon: <Euro size={18} />,
      label: `Fatturato netto (lordo −${taxRate}%)`,
      value: fatturatoNetto,
      prefix: '€',
      decimals: 2,
      sub: `€${fatturatoLordo.toFixed(2)} × ${(1 - taxRate / 100).toFixed(2)}`,
      color: '#22c55e',
      editTax: true,
    },
    {
      icon: <TrendingUp size={18} />,
      label: 'Utile (netto − spese)',
      value: utile,
      prefix: '€',
      decimals: 2,
      sub: `€${fatturatoNetto.toFixed(2)} − spese €${totalCostMonth.toFixed(4)}`,
      color: utile >= 0 ? '#22c55e' : '#ef4444',
      editTax: false,
    },
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
          <div className="flex items-center gap-2">
            {/* Campanella segnalazioni */}
            <div ref={bellRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowBellDropdown((v) => !v)}
                className="btn-ghost flex items-center justify-center"
                style={{ width: 36, height: 36, padding: 0, position: 'relative' }}
                title="Segnalazioni aperte"
              >
                <Bell size={17} />
                {(pendingTickets + adminNotifs.filter(n => !n.is_read).length) > 0 && (
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 16, height: 16, borderRadius: '50%',
                    background: '#ef4444', color: '#fff',
                    fontSize: '0.6rem', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid #060912',
                  }}>
                    {pendingTickets + adminNotifs.filter(n => !n.is_read).length}
                  </span>
                )}
              </button>
              <AnimatePresence>
                {showBellDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -8, scale: 0.96 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -8, scale: 0.96 }}
                    transition={{ duration: 0.15 }}
                    style={{
                      position: 'absolute', top: '110%', right: 0, zIndex: 100,
                      background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 14, minWidth: 300, maxWidth: 360,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.4)', overflow: 'hidden',
                    }}
                  >
                    {/* Nuove registrazioni */}
                    {adminNotifs.length > 0 && (
                      <>
                        <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)', background: 'rgba(16,185,129,0.05)' }}>
                          <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#34d399' }}>
                            Nuove registrazioni ({adminNotifs.filter(n => !n.is_read).length} non lette)
                          </span>
                        </div>
                        <div style={{ maxHeight: 180, overflowY: 'auto' }}>
                          {adminNotifs.map((n) => (
                            <div
                              key={n.id}
                              style={{ padding: '0.6rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', background: n.is_read ? 'transparent' : 'rgba(16,185,129,0.04)', opacity: n.is_read ? 0.6 : 1 }}
                              onClick={() => {
                                apiFetch(`/auth/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {})
                                setAdminNotifs(prev => prev.map(x => x.id === n.id ? {...x, is_read: true} : x))
                              }}
                            >
                              <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f1f5f9', marginBottom: 2 }}>{n.message.split(' — ')[0]}</div>
                              <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{n.message.split(' — ').slice(1).join(' — ')}</div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                    {/* Ticket aperti */}
                    <div style={{ padding: '0.6rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#f1f5f9' }}>
                        Segnalazioni aperte {pendingTickets > 0 && `(${pendingTickets})`}
                      </span>
                    </div>
                    {tickets.filter((t) => t.status === 'in_elaborazione').length === 0 ? (
                      <div style={{ padding: '1rem', fontSize: '0.82rem', color: '#64748b', textAlign: 'center' }}>
                        Nessuna segnalazione aperta
                      </div>
                    ) : (
                      <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                        {tickets.filter((t) => t.status === 'in_elaborazione').map((t) => (
                          <div
                            key={t.id}
                            style={{ padding: '0.7rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.04)', cursor: 'pointer', background: 'rgba(245,158,11,0.04)' }}
                            onClick={() => { openAdminTicket(t.id); setShowBellDropdown(false) }}
                          >
                            <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#f1f5f9', marginBottom: 2 }}>{t.subject}</div>
                            <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginBottom: 2 }}>{t.company_name || t.company_email || '—'}</div>
                            <div style={{ fontSize: '0.68rem', color: '#475569' }}>{new Date(t.created_at).toLocaleDateString('it-IT')}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            <button
              className="btn-ghost flex items-center gap-2"
              style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }}
              onClick={async () => { await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {}); localStorage.clear(); navigate('/login') }}
            >
              <LogOut size={15} /> Esci
            </button>
          </div>
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
        {/* Riga 1: Aziende + Fatturato + Spese mese + Spese dall'inizio */}
        <motion.div variants={cardAnim} className="flex gap-3 mb-3 justify-center" style={{ flexWrap: 'wrap' }}>
          {[...statCards, ...costCards].map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08, duration: 0.5 }}
              className="card flex items-center gap-4"
              style={{ flex: '1 1 180px', maxWidth: 240 }}
            >
              <div style={{ width: 38, height: 38, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b', flexShrink: 0 }}>
                {s.icon}
              </div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 2 }}>{s.label}</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: '#f1f5f9', letterSpacing: '-0.03em' }}>
                  <AnimatedNumber value={s.value} prefix={s.prefix} decimals={(s as any).decimals} />
                </div>
                {(s as any).sub && <div style={{ fontSize: '0.65rem', color: '#475569', marginTop: 2 }}>{(s as any).sub}</div>}
                {s.label === "Spese dall'inizio" && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                    <span style={{ fontSize: '0.65rem', color: '#64748b' }}>Dal:</span>
                    <input
                      type="date" value={startDate}
                      onChange={e => {
                        setStartDate(e.target.value)
                        localStorage.setItem('solardino_start_date', e.target.value)
                      }}
                      style={{ padding: '1px 4px', borderRadius: 5, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)', color: '#f1f5f9', fontSize: '0.65rem', colorScheme: 'dark' }}
                    />
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </motion.div>

        {/* Riga 2: Fatturato lordo + netto + Utile + Grafico */}
        <motion.div variants={cardAnim} className="flex gap-3 mb-4 justify-center" style={{ flexWrap: 'wrap' }}>
          {plCards.slice(0, 2).map((s, i) => (
            <motion.div
              key={s.label}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.32 + i * 0.08, duration: 0.5 }}
              className="card flex items-center gap-4"
              style={{ flex: '1 1 180px', maxWidth: 240 }}
            >
              <div style={{ width: 38, height: 38, background: `${s.color}18`, border: `1px solid ${s.color}40`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: s.color, flexShrink: 0 }}>
                {s.icon}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div className="flex items-center gap-2" style={{ marginBottom: 2 }}>
                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>{s.label}</span>
                  {s.editTax && (
                    editingTaxRate ? (
                      <input
                        type="number" min={0} max={99} value={taxRate}
                        onChange={e => setTaxRate(Math.max(0, Math.min(99, parseInt(e.target.value) || 0)))}
                        onBlur={() => setEditingTaxRate(false)}
                        onKeyDown={e => e.key === 'Enter' && setEditingTaxRate(false)}
                        autoFocus
                        style={{ width: 44, padding: '1px 4px', borderRadius: 5, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(34,197,94,0.3)', color: '#f1f5f9', fontSize: '0.72rem', textAlign: 'center' }}
                      />
                    ) : (
                      <button onClick={() => setEditingTaxRate(true)}
                        style={{ padding: '1px 6px', borderRadius: 5, fontSize: '0.65rem', fontWeight: 700, cursor: 'pointer', border: '1px solid rgba(34,197,94,0.25)', background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}>
                        modifica %
                      </button>
                    )
                  )}
                </div>
                <div style={{ fontSize: '1.4rem', fontWeight: 800, color: s.color, letterSpacing: '-0.03em' }}>
                  € {s.value.toFixed(s.decimals)}
                </div>
                <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: 2 }}>{s.sub}</div>
              </div>
            </motion.div>
          ))}

          {/* Utile */}
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.48, duration: 0.5 }}
            className="card flex items-center gap-4"
            style={{ flex: '1 1 180px', maxWidth: 240 }}
          >
            <div style={{ width: 38, height: 38, background: `${plCards[2].color}18`, border: `1px solid ${plCards[2].color}40`, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: plCards[2].color, flexShrink: 0 }}>
              <TrendingUp size={18} />
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 2 }}>{plCards[2].label}</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 800, color: plCards[2].color, letterSpacing: '-0.03em' }}>
                € {plCards[2].value.toFixed(2)}
              </div>
              <div style={{ fontSize: '0.62rem', color: '#475569', marginTop: 2 }}>{plCards[2].sub}</div>
            </div>
          </motion.div>

          {/* Grafico P&L */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.56, duration: 0.5 }}
            className="card flex items-center justify-center" style={{ flex: '1 1 180px', maxWidth: 240 }}>
            <button onClick={loadProfitChart}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: '0.6rem 1.2rem', borderRadius: 10, border: '1px solid rgba(245,158,11,0.25)', background: 'rgba(245,158,11,0.08)', color: '#f59e0b', cursor: 'pointer', fontWeight: 700, fontSize: '0.78rem' }}>
              <BarChart2 size={24} />
              Grafico P&L
            </button>
          </motion.div>
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
              { key: 'gpu', label: 'Costi GPU', icon: <Zap size={14} /> },
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
                      <th>Abbonamento</th>
                      <th>Scadenza</th>
                      <th>Crediti rimasti</th>
                      <th>Registrata</th>
                      <th>Ultimo accesso</th>
                      <th>IP</th>
                      <th>Stato</th>
                      <th style={{ textAlign: 'right' }}>Costo GPU</th>
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
                          {c.subscription_active && c.subscription_plan ? (
                            <span style={{
                              display: 'inline-block',
                              padding: '2px 9px',
                              borderRadius: 999,
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              textTransform: 'uppercase',
                              letterSpacing: '0.04em',
                              ...(c.subscription_plan === 'starter'          ? { background: 'rgba(59,130,246,0.12)',  color: '#60a5fa' }
                                : c.subscription_plan === 'medium'           ? { background: 'rgba(245,158,11,0.12)', color: '#f59e0b' }
                                : c.subscription_plan === 'unlimited_annual' ? { background: 'rgba(139,92,246,0.12)', color: '#a78bfa' }
                                :                                              { background: 'rgba(34,197,94,0.12)',  color: '#22c55e' }),
                            }}>
                              {c.subscription_plan === 'starter'          ? 'Starter'
                               : c.subscription_plan === 'medium'          ? 'Medium'
                               : c.subscription_plan === 'unlimited_annual' ? 'Annual'
                               : 'Unlimited'}
                            </span>
                          ) : (
                            <span style={{ color: '#475569', fontSize: '0.78rem' }}>—</span>
                          )}
                        </td>
                        <td>
                          <span style={{ fontSize: '0.75rem', color: c.subscription_end_date ? '#94a3b8' : '#475569' }}>
                            {c.subscription_end_date ?? '—'}
                          </span>
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
                        <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 700, color: (c.gpu_cost_eur ?? 0) > 0 ? '#f59e0b' : '#475569', fontSize: '0.8rem', whiteSpace: 'nowrap' }}>
                            {(c.gpu_cost_eur ?? 0) > 0 ? `€ ${c.gpu_cost_eur!.toFixed(4)}` : '—'}
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
                                  { label: '+1 credito (regalo)', color: '#f59e0b', action: () => { setConfirmCreditId(c.id); setConfirmCreditStep(0); setOpenDropdown(null) } },
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
                // Flatten all payments from all companies
                type FlatPayment = BillingPayment & { company_name: string; company_email: string; company_id: number }
                const allPayments: FlatPayment[] = []
                billing.forEach((b) => {
                  const payments = b.payments || []
                  payments.forEach((p) => {
                    // Apply company filter
                    if (billingFilterCompany && !(b.name || '').toLowerCase().includes(billingFilterCompany.toLowerCase())) return
                    // Apply month/year filter
                    const d = new Date(p.date)
                    if (billingFilterMonth && String(d.getMonth() + 1) !== billingFilterMonth) return
                    if (billingFilterYear && String(d.getFullYear()) !== billingFilterYear) return
                    allPayments.push({ ...p, company_name: b.name || '—', company_email: b.email || '', company_id: b.id })
                  })
                })

                if (allPayments.length === 0) {
                  return (
                    <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>
                      Nessun dato di fatturazione disponibile
                    </div>
                  )
                }

                // Raggruppa per mese (come recensioni)
                const byMonth: Record<string, FlatPayment[]> = {}
                allPayments.forEach((p) => {
                  const key = new Date(p.date).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
                  if (!byMonth[key]) byMonth[key] = []
                  byMonth[key].push(p)
                })
                const months = Object.keys(byMonth)

                return (
                  <div className="flex flex-col gap-5">
                    {months.map((month) => {
                      const monthPayments = byMonth[month]
                      const monthTotal = monthPayments.reduce((s, p) => s + (p.amount_eur ?? 0), 0)
                      return (
                        <div key={month}>
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid rgba(245,158,11,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{month} · {monthPayments.length} pagament{monthPayments.length === 1 ? 'o' : 'i'}</span>
                            <span style={{ color: '#22c55e' }}>€{monthTotal.toFixed(2)}</span>
                          </div>
                          <div className="flex flex-col gap-2">
                            {monthPayments.map((p) => {
                              const statusColor = p.status === 'approved' ? '#22c55e' : p.status === 'rejected' ? '#ef4444' : '#f59e0b'
                              const statusLabel = p.status === 'approved' ? 'Approvato' : p.status === 'rejected' ? 'Rifiutato' : 'In attesa'
                              return (
                                <div
                                  key={p.id}
                                  className="flex items-center justify-between rounded-lg px-3 py-2.5"
                                  style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.05)' }}
                                >
                                  <div className="flex items-center gap-3">
                                    <div style={{ width: 30, height: 30, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', background: p.type === 'stripe' ? 'rgba(99,102,241,0.12)' : 'rgba(245,158,11,0.1)' }}>
                                      {p.type === 'stripe' ? '💳' : '🏦'}
                                    </div>
                                    <div>
                                      <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#f1f5f9' }}>
                                        {p.method_label} · +{p.credits} crediti
                                      </div>
                                      <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 500 }}>
                                        {p.company_name}
                                      </div>
                                      <div style={{ fontSize: '0.68rem', color: '#475569' }}>
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
                                          const res = await fetch(`/sys-ctrl/bonifico-requests/${p.receipt_id}/receipt`, { credentials: 'include' })
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
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', margin: 0 }}>
                  Recensioni ({adminReviews.length})
                </h3>
                <div className="flex items-center gap-2">
                  <select value={reviewsFilterMonth} onChange={(e) => setReviewsFilterMonth(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.4rem 0.75rem', color: reviewsFilterMonth ? '#f1f5f9' : '#64748b', fontSize: '0.8rem' }}>
                    <option value="">Tutti i mesi</option>
                    {['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'].map((m, i) => (
                      <option key={m} value={String(i + 1)}>{m}</option>
                    ))}
                  </select>
                  <select value={reviewsFilterYear} onChange={(e) => setReviewsFilterYear(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.4rem 0.75rem', color: reviewsFilterYear ? '#f1f5f9' : '#64748b', fontSize: '0.8rem' }}>
                    <option value="">Tutti gli anni</option>
                    {[2025, 2026, 2027].map((y) => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </div>
              </div>

              {(() => {
                const filteredReviews = adminReviews.filter((r) => {
                  if (!r.created_at) return true
                  const d = new Date(r.created_at)
                  if (reviewsFilterMonth && String(d.getMonth() + 1) !== reviewsFilterMonth) return false
                  if (reviewsFilterYear && String(d.getFullYear()) !== reviewsFilterYear) return false
                  return true
                })
                // Raggruppa per mese
                const byMonth: Record<string, typeof filteredReviews> = {}
                filteredReviews.forEach((r) => {
                  const key = r.created_at
                    ? new Date(r.created_at).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
                    : 'Data sconosciuta'
                  if (!byMonth[key]) byMonth[key] = []
                  byMonth[key].push(r)
                })
                const months = Object.keys(byMonth)
                if (months.length === 0) return (
                  <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>Nessuna recensione</div>
                )
                return (
                  <div className="flex flex-col gap-5">
                    {months.map((month) => (
                      <div key={month}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
                          {month} · {byMonth[month].length} recension{byMonth[month].length === 1 ? 'e' : 'i'}
                        </div>
                        <div className="flex flex-col gap-3">
                          {byMonth[month].map((r) => {
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
                      </div>
                    ))}
                  </div>
                )
              })()}
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
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', margin: 0 }}>
                  Segnalazioni / Ticket
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Sub-tab */}
                  <div className="flex gap-1" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: '3px' }}>
                    {(['aperte', 'chiuse'] as const).map((sub) => (
                      <button key={sub} onClick={() => setAdminTicketSubTab(sub)}
                        style={{ background: adminTicketSubTab === sub ? 'rgba(245,158,11,0.15)' : 'transparent', border: adminTicketSubTab === sub ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent', color: adminTicketSubTab === sub ? '#f59e0b' : '#64748b', borderRadius: 8, padding: '0.3rem 0.9rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer' }}>
                        {sub === 'aperte' ? `In elaborazione (${tickets.filter(t => t.status !== 'risolto').length})` : `Chiuse (${tickets.filter(t => t.status === 'risolto').length})`}
                      </button>
                    ))}
                  </div>
                  {/* Filtri mese */}
                  <select value={ticketsFilterMonth} onChange={(e) => setTicketsFilterMonth(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.4rem 0.75rem', color: ticketsFilterMonth ? '#f1f5f9' : '#64748b', fontSize: '0.8rem' }}>
                    <option value="">Tutti i mesi</option>
                    {['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'].map((m, i) => (
                      <option key={m} value={String(i + 1)}>{m}</option>
                    ))}
                  </select>
                  <select value={ticketsFilterYear} onChange={(e) => setTicketsFilterYear(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.4rem 0.75rem', color: ticketsFilterYear ? '#f1f5f9' : '#64748b', fontSize: '0.8rem' }}>
                    <option value="">Tutti gli anni</option>
                    {[2025, 2026, 2027].map((y) => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </div>
              </div>

              {(() => {
                const byStatus = tickets.filter(t => adminTicketSubTab === 'chiuse' ? t.status === 'risolto' : t.status !== 'risolto')
                const filtered = byStatus.filter((t) => {
                  if (!t.created_at) return true
                  const d = new Date(t.created_at)
                  if (ticketsFilterMonth && String(d.getMonth() + 1) !== ticketsFilterMonth) return false
                  if (ticketsFilterYear && String(d.getFullYear()) !== ticketsFilterYear) return false
                  return true
                })
                // Raggruppa per mese
                const byMonth: Record<string, typeof filtered> = {}
                filtered.forEach((t) => {
                  const key = t.created_at
                    ? new Date(t.created_at).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
                    : 'Data sconosciuta'
                  if (!byMonth[key]) byMonth[key] = []
                  byMonth[key].push(t)
                })
                const months = Object.keys(byMonth)
                if (months.length === 0) return (
                  <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>Nessuna segnalazione</div>
                )
                return (
                  <div className="flex flex-col gap-5">
                    {months.map((month) => (
                      <div key={month}>
                        <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, paddingBottom: 6, borderBottom: '1px solid rgba(245,158,11,0.15)' }}>
                          {month} · {byMonth[month].length} ticket
                        </div>
                        <div className="flex flex-col gap-2">
                          {byMonth[month].map((t) => {
                      const statusColor = t.status === 'risolto' ? '#22c55e' : '#eab308'
                      const statusLabel = t.status === 'risolto' ? 'Chiuso' : 'In elaborazione'
                      return (
                        <button
                          key={t.id}
                          className="w-full text-left rounded-xl p-3"
                          style={{
                            background: 'rgba(255,255,255,0.025)',
                            border: `1px solid ${t.status === 'risolto' ? 'rgba(34,197,94,0.12)' : 'rgba(255,255,255,0.07)'}`,
                            cursor: 'pointer',
                          }}
                          onClick={() => openAdminTicket(t.id)}
                        >
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span style={{ fontSize: '0.7rem', color: '#475569', fontWeight: 700 }}>#{t.id}</span>
                              <span style={{ fontSize: '0.85rem', color: '#f1f5f9', fontWeight: 600 }}>{t.subject}</span>
                              <span style={{ fontSize: '0.68rem', fontWeight: 600, color: statusColor, background: `${statusColor}18`, border: `1px solid ${statusColor}40`, borderRadius: 5, padding: '0.12rem 0.4rem' }}>
                                {statusLabel}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <span style={{ fontSize: '0.75rem', color: '#64748b' }}>{t.company_name || '—'}</span>
                              <span style={{ fontSize: '0.7rem', color: '#475569' }}>
                                {new Date(t.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
                              </span>
                              <ChevronRight size={13} style={{ color: '#475569' }} />
                            </div>
                          </div>
                        </button>
                      )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}

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
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', margin: 0 }}>
                  File caricati dagli utenti ({uploads.length} aziende)
                </h3>
                <div className="flex items-center gap-2 flex-wrap">
                  <input type="text" placeholder="Filtra per azienda..."
                    value={uploadsFilterCompany} onChange={(e) => setUploadsFilterCompany(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.4rem 0.75rem', color: '#f1f5f9', fontSize: '0.8rem', minWidth: 160 }} />
                  <select value={uploadsFilterMonth} onChange={(e) => setUploadsFilterMonth(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.4rem 0.75rem', color: uploadsFilterMonth ? '#f1f5f9' : '#64748b', fontSize: '0.8rem' }}>
                    <option value="">Tutti i mesi</option>
                    {['Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno','Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'].map((m, i) => (
                      <option key={m} value={String(i + 1)}>{m}</option>
                    ))}
                  </select>
                  <select value={uploadsFilterYear} onChange={(e) => setUploadsFilterYear(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, padding: '0.4rem 0.75rem', color: uploadsFilterYear ? '#f1f5f9' : '#64748b', fontSize: '0.8rem' }}>
                    <option value="">Tutti gli anni</option>
                    {[2025, 2026, 2027].map((y) => <option key={y} value={String(y)}>{y}</option>)}
                  </select>
                </div>
              </div>

              {(() => {
                const filteredUploads = uploads.filter((c) => {
                  if (uploadsFilterCompany && !(c.company_name || '').toLowerCase().includes(uploadsFilterCompany.toLowerCase())) return false
                  if (uploadsFilterMonth || uploadsFilterYear) {
                    const hasMatch = c.jobs.some((j) => {
                      if (!j.created_at) return false
                      const d = new Date(j.created_at)
                      if (uploadsFilterMonth && String(d.getMonth() + 1) !== uploadsFilterMonth) return false
                      if (uploadsFilterYear && String(d.getFullYear()) !== uploadsFilterYear) return false
                      return true
                    })
                    if (!hasMatch) return false
                  }
                  return true
                })
                if (filteredUploads.length === 0) return (
                  <div style={{ textAlign: 'center', color: '#475569', fontSize: '0.875rem', padding: '2rem 0' }}>Nessun file caricato</div>
                )
                return (
                <div className="flex flex-col gap-2">
                  {filteredUploads.map((company) => {
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
                                      ) : (() => {
                                        const inputExts = ['tif', 'tiff', 'tfw']
                                        const inputFiles = job.files.filter(f => inputExts.includes(f.name.split('.').pop()?.toLowerCase() ?? ''))
                                        const outputFiles = job.files.filter(f => !inputExts.includes(f.name.split('.').pop()?.toLowerCase() ?? ''))
                                        const renderFile = (file: UploadedFile) => {
                                          const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
                                          const icon = ext === 'pdf' ? '📄' : ext === 'tif' || ext === 'tiff' ? '🗺️' : ext === 'jpg' || ext === 'png' ? '🖼️' : ext === 'tfw' ? '🗺️' : '📋'
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
                                                  const res = await fetch(`/sys-ctrl/jobs/${job.job_id}/files/${encodeURIComponent(file.name)}`, {
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
                                        }
                                        return (
                                          <div className="flex flex-col gap-3">
                                            {inputFiles.length > 0 && (
                                              <div>
                                                <div style={{ fontSize: '0.65rem', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, paddingBottom: 3, borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                                                  📥 File di input ({inputFiles.length})
                                                </div>
                                                <div className="flex flex-col gap-1 mt-1">
                                                  {inputFiles.map(renderFile)}
                                                </div>
                                              </div>
                                            )}
                                            {outputFiles.length > 0 && (
                                              <div>
                                                <div style={{ fontSize: '0.65rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4, paddingBottom: 3, borderBottom: '1px solid rgba(245,158,11,0.12)' }}>
                                                  📤 File di output ({outputFiles.length})
                                                </div>
                                                <div className="flex flex-col gap-1 mt-1">
                                                  {outputFiles.map(renderFile)}
                                                </div>
                                              </div>
                                            )}
                                          </div>
                                        )
                                      })()}
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
                )
              })()}
            </motion.div>
          )}
          {tab === 'gpu' && (
            <motion.div
              key="gpu"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.25 }}
              className="card mt-4"
            >
              <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
                <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.975rem', margin: 0 }}>
                  Costi GPU stimati per azienda
                </h3>
                <span style={{ fontSize: '0.75rem', color: '#64748b' }}>
                  Durata job × <code style={{ color: '#f59e0b' }}>RUNPOD_COST_PER_SEC</code> (default NVIDIA A10 ≈ €0.000306/s)
                </span>
              </div>
              {/* Supabase plan selector + storage + cleanup */}
              {(() => {
                const SUPABASE_FREE_STORAGE_MB = 1024
                const SUPABASE_PRO_STORAGE_MB  = 102400
                const SUPABASE_FREE_DB_MB       = 500
                const SUPABASE_PRO_DB_MB        = 8192
                const storageLimitMb  = supabasePlan === 'pro' ? SUPABASE_PRO_STORAGE_MB : SUPABASE_FREE_STORAGE_MB
                const dbLimitMb       = supabasePlan === 'pro' ? SUPABASE_PRO_DB_MB      : SUPABASE_FREE_DB_MB
                const usedStorageMb   = storageInfo?.used_mb ?? 0
                const usedDbMb        = dbInfo?.used_mb ?? 0
                const storagePct      = Math.min((usedStorageMb / storageLimitMb) * 100, 100)
                const dbPct           = Math.min((usedDbMb / dbLimitMb) * 100, 100)
                const fixedCosts      = [
                  { label: 'Dominio', eur: domainCostActive ? domainCostEur : 0.00, toggle: () => setDomainCostActive((v) => !v), active: domainCostActive, editable: true },
                  { label: 'Fly.io',  eur: 0.00, editable: false },
                  { label: 'Supabase', eur: supabasePlan === 'pro' ? 23.00 : 0.00, editable: false, planToggle: true },
                ]

                function fmtMb(mb: number, limitMb: number) {
                  if (limitMb >= 1024) return `${mb.toFixed(0)} MB / ${(limitMb/1024).toFixed(0)} GB`
                  return `${mb.toFixed(0)} / ${limitMb} MB`
                }

                async function handleCleanup() {
                  setCleanupLoading(true)
                  setCleanupMsg('')
                  try {
                    // 1. Scarica i file prima di cancellare
                    const prev = await apiFetch('/sys-ctrl/cleanup-preview')
                    if (prev.ok) {
                      const jobs: Array<{ job_id: string; company_name: string; files: Array<{ name: string; url: string | null }> }> = await prev.json()
                      const allFiles = jobs.flatMap(j => j.files.filter(f => f.url))
                      if (allFiles.length > 0) {
                        if (!confirm(`Verranno scaricati ${allFiles.length} file e poi eliminati da Supabase. Continuare?`)) {
                          setCleanupLoading(false); return
                        }
                        for (const f of allFiles) {
                          const a = document.createElement('a')
                          a.href = f.url!
                          a.download = f.name
                          a.target = '_blank'
                          document.body.appendChild(a)
                          a.click()
                          document.body.removeChild(a)
                          await new Promise(r => setTimeout(r, 300))
                        }
                      } else {
                        if (!confirm('Nessun file da scaricare. Eliminare i job più vecchi da Supabase?')) {
                          setCleanupLoading(false); return
                        }
                      }
                    }
                    // 2. Elimina
                    const res = await apiFetch('/sys-ctrl/cleanup-oldest', { method: 'POST' })
                    const d   = await res.json()
                    setCleanupMsg(`Eliminati ${d.deleted_files} file · liberati ${d.freed_mb} MB`)
                    apiFetch('/sys-ctrl/supabase-storage').then(r => r.ok ? r.json() : null).then(d => { if (d) setStorageInfo(d) })
                  } finally {
                    setCleanupLoading(false)
                  }
                }

                function UsageBar({ label, pct, info }: { label: string; pct: number; info: string }) {
                  return (
                    <div style={{ marginBottom: '0.75rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                        <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
                        <div style={{ fontSize: '0.72rem', color: pct > 80 ? '#ef4444' : '#64748b' }}>{info}</div>
                      </div>
                      <div style={{ height: 7, background: 'rgba(255,255,255,0.06)', borderRadius: 999, overflow: 'hidden' }}>
                        <div style={{ height: '100%', width: `${pct}%`, background: pct > 80 ? '#ef4444' : pct > 60 ? '#f59e0b' : '#22c55e', borderRadius: 999, transition: 'width 0.6s ease' }} />
                      </div>
                    </div>
                  )
                }

                return (
                  <div style={{ marginBottom: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {/* Utilizzo Storage + DB + cleanup */}
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: '1rem', flex: '1 1 0' }}>
                        <UsageBar label="Storage file" pct={storagePct} info={fmtMb(usedStorageMb, storageLimitMb)} />
                        <UsageBar label="Database"     pct={dbPct}      info={fmtMb(usedDbMb, dbLimitMb)} />
                        <div style={{ fontSize: '0.68rem', color: '#475569', marginBottom: '0.75rem' }}>{storageInfo?.file_count ?? 0} file job · {storagePct.toFixed(1)}% storage · {dbPct.toFixed(1)}% DB</div>
                        <button onClick={handleCleanup} disabled={cleanupLoading} style={{ width: '100%', padding: '0.45rem', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700, cursor: cleanupLoading ? 'not-allowed' : 'pointer', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.08)', color: '#ef4444', opacity: cleanupLoading ? 0.6 : 1 }}>
                          {cleanupLoading ? 'In corso...' : '🗑 Scarica + elimina 10 job più vecchi'}
                        </button>
                        {cleanupMsg && <div style={{ fontSize: '0.72rem', color: '#22c55e', marginTop: 6 }}>{cleanupMsg}</div>}
                      </div>
                    </div>

                    {/* Spese fisse mensili — centrate */}
                    <div>
                      <div style={{ color: '#94a3b8', fontWeight: 700, fontSize: '0.8rem', marginBottom: '0.6rem', textTransform: 'uppercase', letterSpacing: '0.06em', textAlign: 'center' }}>Spese fisse mensili</div>
                      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {fixedCosts.map((c) => (
                          <div key={c.label} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${'toggle' in c && !(c as any).active ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.08)'}`, borderRadius: 10, padding: '0.6rem 1.2rem', textAlign: 'center', opacity: 'toggle' in c && !(c as any).active ? 0.5 : 1 }}>
                            <div style={{ fontSize: '0.72rem', color: '#64748b', marginBottom: 3 }}>{c.label}</div>
                            {(c as any).planToggle ? (
                              <>
                                <div style={{ display: 'flex', gap: '0.35rem', justifyContent: 'center', marginBottom: 4 }}>
                                  {(['free', 'pro'] as const).map((p) => (
                                    <button key={p} onClick={() => setSupabasePlan(p)} style={{ padding: '0.2rem 0.7rem', borderRadius: 6, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', border: 'none', background: supabasePlan === p ? (p === 'pro' ? 'rgba(139,92,246,0.25)' : 'rgba(245,158,11,0.2)') : 'rgba(255,255,255,0.04)', color: supabasePlan === p ? (p === 'pro' ? '#a78bfa' : '#f59e0b') : '#475569' }}>
                                      {p === 'free' ? 'Free' : 'Pro'}
                                    </button>
                                  ))}
                                </div>
                                <div style={{ fontWeight: 700, color: c.eur > 0 ? '#a78bfa' : '#475569', fontSize: '0.9rem' }}>
                                  {c.eur > 0 ? `€ ${c.eur.toFixed(2)}/mese` : 'Free'}
                                </div>
                              </>
                            ) : (c as any).editable ? (
                              editingDomainCost ? (
                                <div className="flex items-center gap-1 justify-center" style={{ marginBottom: 4 }}>
                                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>€</span>
                                  <input
                                    type="number" min={0} step={0.01}
                                    value={domainCostInput}
                                    onChange={(e) => setDomainCostInput(e.target.value)}
                                    onBlur={() => { const v = parseFloat(domainCostInput); if (!isNaN(v) && v >= 0) setDomainCostEur(v); setEditingDomainCost(false) }}
                                    onKeyDown={(e) => { if (e.key === 'Enter') { const v = parseFloat(domainCostInput); if (!isNaN(v) && v >= 0) setDomainCostEur(v); setEditingDomainCost(false) } }}
                                    autoFocus
                                    style={{ width: 64, background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 6, padding: '1px 6px', color: '#f1f5f9', fontSize: '0.8rem' }}
                                  />
                                  <span style={{ fontSize: '0.72rem', color: '#64748b' }}>/mese</span>
                                </div>
                              ) : (
                                <div
                                  style={{ fontWeight: 700, color: c.eur > 0 ? '#f59e0b' : '#475569', fontSize: '0.9rem', cursor: 'pointer', marginBottom: 2 }}
                                  onClick={() => { setDomainCostInput(domainCostEur.toFixed(2)); setEditingDomainCost(true) }}
                                  title="Clicca per modificare il prezzo"
                                >
                                  {(c as any).active ? `€ ${c.eur.toFixed(2)}/mese ✏️` : '€ 0.00 (off)'}
                                </div>
                              )
                            ) : (
                              <div style={{ fontWeight: 700, color: c.eur > 0 ? '#f59e0b' : '#475569', fontSize: '0.9rem' }}>
                                {c.eur > 0 ? `€ ${c.eur.toFixed(2)}/mese` : 'Free'}
                              </div>
                            )}
                            {'toggle' in c && (
                              <button
                                onClick={(c as any).toggle}
                                style={{ marginTop: 6, padding: '0.2rem 0.7rem', borderRadius: 6, fontSize: '0.68rem', fontWeight: 700, cursor: 'pointer', border: 'none', background: (c as any).active ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)', color: (c as any).active ? '#22c55e' : '#ef4444' }}
                              >
                                {(c as any).active ? 'Attivo' : 'Spento'}
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )
              })()}

              {/* Month filter */}
              {gpuMonths.length > 0 && (
                <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                  <button
                    onClick={() => setGpuMonthFilter('all')}
                    style={{ padding: '0.2rem 0.75rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', border: 'none', background: gpuMonthFilter === 'all' ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.05)', color: gpuMonthFilter === 'all' ? '#f59e0b' : '#475569' }}
                  >Tutti</button>
                  {gpuMonths.map(m => (
                    <button key={m} onClick={() => setGpuMonthFilter(m)}
                      style={{ padding: '0.2rem 0.75rem', borderRadius: 6, fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', border: 'none', background: gpuMonthFilter === m ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.05)', color: gpuMonthFilter === m ? '#f59e0b' : '#475569' }}
                    >{new Date(m + '-01').toLocaleDateString('it-IT', { month: 'short', year: 'numeric' })}</button>
                  ))}
                </div>
              )}

              {filteredGpuCosts.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '0.75rem' }}>
                  <div style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', borderRadius: 10, padding: '0.4rem 1.2rem', fontWeight: 700, color: '#f59e0b', fontSize: '0.95rem' }}>
                    Totale{gpuMonthFilter !== 'all' ? ` ${new Date(gpuMonthFilter + '-01').toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })}` : ''} &nbsp;·&nbsp; € {filteredGpuCosts.reduce((acc, r) => acc + r.cost_eur, 0).toFixed(4)}
                  </div>
                </div>
              )}

              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Azienda</th>
                      <th>Email</th>
                      <th style={{ textAlign: 'right' }}>Job</th>
                      <th style={{ textAlign: 'right' }}>Tempo GPU</th>
                      <th style={{ textAlign: 'right' }}>Costo stimato</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredGpuCosts.length === 0 && (
                      <tr><td colSpan={5} style={{ textAlign: 'center', color: '#64748b', padding: '1.5rem' }}>Nessun job{gpuMonthFilter !== 'all' ? ' per questo mese' : ''}</td></tr>
                    )}
                    {filteredGpuCosts.map((r, i) => {
                      const h = Math.floor(r.total_seconds / 3600)
                      const m = Math.floor((r.total_seconds % 3600) / 60)
                      const s = r.total_seconds % 60
                      const hms = `${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm ' : ''}${s}s`
                      const isOpen = expandedGpuCompany === r.company_name
                      return (
                        <>
                          <tr key={i} style={{ cursor: 'pointer' }} onClick={() => setExpandedGpuCompany(isOpen ? null : r.company_name)}>
                            <td>
                              <div className="flex items-center gap-2">
                                {isOpen ? <ChevronDown size={13} style={{ color: '#f59e0b', flexShrink: 0 }} /> : <ChevronRight size={13} style={{ color: '#64748b', flexShrink: 0 }} />}
                                {r.company_name}
                              </div>
                            </td>
                            <td style={{ color: '#64748b' }}>{r.company_email}</td>
                            <td style={{ textAlign: 'right' }}>{r.job_count}</td>
                            <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{hms}</td>
                            <td style={{ textAlign: 'right', fontWeight: 700, color: '#f59e0b', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                              € {r.cost_eur.toFixed(4)}
                            </td>
                          </tr>
                          {isOpen && r.jobs.map((j, ji) => {
                            const jh = Math.floor(j.seconds / 3600)
                            const jm = Math.floor((j.seconds % 3600) / 60)
                            const js2 = j.seconds % 60
                            const jhms = `${jh > 0 ? jh + 'h ' : ''}${jm > 0 ? jm + 'm ' : ''}${js2}s`
                            return (
                              <tr key={`${i}-${ji}`} style={{ background: 'rgba(245,158,11,0.03)' }}>
                                <td colSpan={2} style={{ paddingLeft: '2.5rem', fontSize: '0.78rem', color: '#94a3b8' }}>
                                  <span style={{ fontFamily: 'monospace', color: '#64748b', marginRight: 8 }}>#{j.job_id}</span>
                                  {new Date(j.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: '2-digit', year: 'numeric' })}
                                </td>
                                <td style={{ textAlign: 'right', fontSize: '0.78rem', color: '#64748b' }}>1</td>
                                <td style={{ textAlign: 'right', fontSize: '0.78rem', color: '#94a3b8', fontVariantNumeric: 'tabular-nums' }}>{jhms}</td>
                                <td style={{ textAlign: 'right', fontSize: '0.78rem', fontWeight: 600, color: '#f59e0b', fontVariantNumeric: 'tabular-nums' }}>
                                  € {j.cost_eur.toFixed(4)}
                                </td>
                              </tr>
                            )
                          })}
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
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

      {/* P&L Chart modal */}
      <AnimatePresence>
        {showPLChart && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.78)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
            onClick={() => setShowPLChart(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
              style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, width: '100%', maxWidth: 720, padding: '1.5rem', maxHeight: '90vh', overflowY: 'auto' }}
            >
              <div className="flex items-center justify-between mb-5">
                <div>
                  <h3 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Grafico P&amp;L mensile</h3>
                  <div style={{ fontSize: '0.72rem', color: '#64748b', marginTop: 3 }}>Utile (fatturato−{taxRate}% tasse) e spese per mese</div>
                </div>
                <button onClick={() => setShowPLChart(false)} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
              </div>

              {chartLoading ? (
                <div style={{ textAlign: 'center', color: '#475569', padding: '2rem' }}>Caricamento...</div>
              ) : monthlyChartData.length === 0 ? (
                <div style={{ textAlign: 'center', color: '#475569', padding: '2rem' }}>Nessun dato disponibile</div>
              ) : (() => {
                const bars = monthlyChartData.map((ms) => {
                  const lordo  = ms.revenue_eur
                  const netto  = lordo * (1 - taxRate / 100)
                  const spese  = ms.gpu_cost_eur + FIXED_MONTHLY_EUR
                  const utileM = netto - spese
                  return { label: ms.label, netto, spese, utile: utileM }
                })

                const allVals = bars.flatMap((b) => [b.utile, b.spese, b.netto])
                const maxAbs = Math.max(...allVals.map(Math.abs), 0.01)
                const chartH = 160
                const zeroY = chartH / 2

                return (
                  <div>
                    {/* Legend */}
                    <div className="flex gap-4 mb-4 flex-wrap" style={{ justifyContent: 'center' }}>
                      {[
                        { color: '#22c55e', label: 'Utile (fatturato−tasse)' },
                        { color: '#ef4444', label: 'Spese totali' },
                        { color: '#f59e0b', label: 'Utile netto' },
                      ].map((l) => (
                        <div key={l.label} className="flex items-center gap-1.5">
                          <div style={{ width: 10, height: 10, borderRadius: 3, background: l.color }} />
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8' }}>{l.label}</span>
                        </div>
                      ))}
                    </div>

                    <svg width="100%" height={chartH + 40} style={{ overflow: 'visible' }}>
                      {/* Zero line */}
                      <line x1="0%" y1={zeroY} x2="100%" y2={zeroY} stroke="rgba(255,255,255,0.12)" strokeWidth={1} />

                      {bars.map((b, i) => {
                        const n = bars.length
                        const groupW = 100 / n
                        const barW = groupW * 0.22
                        const gapX = groupW * i

                        const toY = (v: number) => zeroY - (v / maxAbs) * (chartH / 2)
                        const barRect = (v: number, offsetPct: number, color: string) => {
                          const y1 = toY(v)
                          const y2 = zeroY
                          const top = Math.min(y1, y2)
                          const h = Math.abs(y1 - y2)
                          return (
                            <rect
                              x={`${gapX + offsetPct}%`}
                              y={top}
                              width={`${barW}%`}
                              height={Math.max(h, 1.5)}
                              rx={2}
                              fill={color}
                              opacity={0.85}
                            />
                          )
                        }

                        return (
                          <g key={i}>
                            {barRect(b.utile,  groupW * 0.05, '#22c55e')}
                            {barRect(b.spese > 0 ? -b.spese : 0, groupW * 0.29, '#ef4444')}
                            {barRect(b.netto,  groupW * 0.53, '#f59e0b')}
                            <text
                              x={`${gapX + groupW * 0.39}%`}
                              y={chartH + 16}
                              textAnchor="middle"
                              fill="#475569"
                              fontSize={9}
                            >
                              {b.label.slice(0, 6)}
                            </text>
                          </g>
                        )
                      })}
                    </svg>

                    {/* Table summary */}
                    <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
                      <table className="data-table" style={{ fontSize: '0.78rem' }}>
                        <thead>
                          <tr>
                            <th>Mese</th>
                            <th style={{ textAlign: 'right', color: '#22c55e' }}>Fatturato netto</th>
                            <th style={{ textAlign: 'right', color: '#ef4444' }}>Spese</th>
                            <th style={{ textAlign: 'right', color: '#f59e0b' }}>Utile (netto−spese)</th>
                          </tr>
                        </thead>
                        <tbody>
                          {bars.map((b, i) => (
                            <tr key={i}>
                              <td style={{ color: '#94a3b8' }}>{monthlyChartData[i].label}</td>
                              <td style={{ textAlign: 'right', color: '#22c55e' }}>€ {b.netto.toFixed(2)}</td>
                              <td style={{ textAlign: 'right', color: '#ef4444' }}>€ {b.spese.toFixed(4)}</td>
                              <td style={{ textAlign: 'right', fontWeight: 700, color: b.utile > 0 ? '#22c55e' : b.utile < 0 ? '#ef4444' : '#f59e0b' }}>€ {b.utile.toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )
              })()}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Ticket chat modal */}
      <AnimatePresence>
        {adminTicketDetail && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
            onClick={() => setAdminTicketDetail(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }}
              transition={{ duration: 0.22 }}
              onClick={(e) => e.stopPropagation()}
              style={{ background: '#0d1117', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 20, width: '100%', maxWidth: 600, overflow: 'hidden', display: 'flex', flexDirection: 'column', maxHeight: '90vh' }}
            >
              {/* Header */}
              <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(255,255,255,0.07)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexShrink: 0 }}>
                <div>
                  <div style={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>
                    Ticket #{adminTicketDetail.id} · {adminTicketDetail.company_name}
                  </div>
                  <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '0.95rem' }}>{adminTicketDetail.subject}</div>
                  <div style={{ marginTop: 4 }}>
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 700, padding: '0.12rem 0.5rem', borderRadius: 5,
                      ...(adminTicketDetail.status === 'risolto'
                        ? { background: 'rgba(34,197,94,0.12)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }
                        : { background: 'rgba(234,179,8,0.12)', color: '#eab308', border: '1px solid rgba(234,179,8,0.3)' }),
                    }}>
                      {adminTicketDetail.status === 'risolto' ? 'Chiuso' : 'In elaborazione'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {adminTicketDetail.status !== 'risolto' && (
                    <button
                      className="btn-ghost"
                      style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem', color: '#22c55e', borderColor: 'rgba(34,197,94,0.3)', whiteSpace: 'nowrap' }}
                      onClick={() => updateTicketStatus(adminTicketDetail.id, 'risolto')}
                    >
                      <Check size={12} /> Chiudi tiket
                    </button>
                  )}
                  <button className="btn-ghost" style={{ padding: '0.3rem' }} onClick={() => setAdminTicketDetail(null)}>
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Messages */}
              <div style={{ padding: '1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto', flex: 1 }}>
                {adminTicketDetail.messages.length === 0 && (
                  <div style={{ color: '#475569', fontSize: '0.82rem', textAlign: 'center', padding: '1rem 0' }}>
                    Nessun messaggio ancora.
                  </div>
                )}
                {adminTicketDetail.messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: m.sender === 'admin' ? 'flex-end' : 'flex-start',
                      maxWidth: '78%',
                      background: m.sender === 'admin' ? 'linear-gradient(135deg,#f59e0b,#f97316)' : 'rgba(255,255,255,0.07)',
                      border: m.sender === 'client' ? '1px solid rgba(255,255,255,0.1)' : 'none',
                      borderRadius: m.sender === 'admin' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      padding: '0.6rem 0.85rem',
                    }}
                  >
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, marginBottom: 3, color: m.sender === 'admin' ? 'rgba(0,0,0,0.6)' : '#f59e0b' }}>
                      {m.sender === 'admin' ? 'SolarDino (Admin)' : adminTicketDetail.company_name || 'Cliente'}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: m.sender === 'admin' ? '#000' : '#f1f5f9', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.text}</div>
                    <div style={{ fontSize: '0.62rem', color: m.sender === 'admin' ? 'rgba(0,0,0,0.5)' : '#475569', marginTop: 4, textAlign: 'right' }}>
                      {new Date(m.created_at).toLocaleString('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Reply input */}
              {adminTicketDetail.status !== 'risolto' ? (
                <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.07)', display: 'flex', gap: 8, alignItems: 'flex-end', flexShrink: 0 }}>
                  <textarea
                    rows={2}
                    placeholder="Scrivi la risposta al cliente..."
                    value={adminReplyText}
                    onChange={(e) => setAdminReplyText(e.target.value)}
                    style={{ flex: 1, background: '#060912', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10, padding: '0.6rem 0.85rem', color: '#f1f5f9', fontSize: '0.85rem', resize: 'none' }}
                  />
                  <button
                    className="btn-amber"
                    style={{ fontSize: '0.8rem', padding: '0.6rem 1rem', flexShrink: 0 }}
                    disabled={adminReplyLoading || !adminReplyText.trim()}
                    onClick={sendAdminReply}
                  >
                    {adminReplyLoading ? 'Invio...' : 'Invia'}
                  </button>
                </div>
              ) : (
                <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(255,255,255,0.07)', fontSize: '0.8rem', color: '#475569', textAlign: 'center', flexShrink: 0 }}>
                  Ticket chiuso — il cliente ha ricevuto notifica.
                </div>
              )}
            </motion.div>
          </motion.div>
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
                  color: confirmCreditStep === 0 ? '#f1f5f9' : '#f59e0b',
                  fontWeight: 900,
                  fontSize: '1.05rem',
                  marginBottom: 8,
                }}>
                  {confirmCreditStep === 0 && 'Regalare 1 credito?'}
                  {confirmCreditStep === 1 && 'Sicuro?'}
                </h3>

                <p style={{
                  color: '#64748b',
                  fontSize: '0.875rem',
                  lineHeight: 1.6,
                  marginBottom: 24,
                }}>
                  {confirmCreditStep === 0 && "Verrà aggiunto 1 credito all'azienda selezionata."}
                  {confirmCreditStep === 1 && 'Questa azienda ha già dei crediti. Vuoi davvero aggiungerne un altro?'}
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
                      border: '2px solid rgba(245,158,11,0.5)',
                      background: 'transparent',
                      color: '#f59e0b',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      if (confirmCreditStep < 1) {
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
                        await apiFetch(`/sys-ctrl/companies/${c.id}/deactivate`, { method: 'POST' })
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
