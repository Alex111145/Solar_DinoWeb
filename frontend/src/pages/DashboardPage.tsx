import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, Upload, CreditCard, History, Star, LogOut,
  X, FileDown, Check, AlertTriangle, Trash2,
  Mail, Lock, Building2, ChevronRight, Zap, Moon,
  Wifi, WifiOff, RefreshCw, Radio, Bell,
} from 'lucide-react'
import { apiFetch } from '../api'

// ── One-time credit pricing (mirrors backend CREDIT_TIERS) ────────────────
const CREDIT_TIERS = [
  { min: 50, price: 39.99, discount: 47 },
  { min: 20, price: 49.99, discount: 33 },
  { min: 10, price: 54.99, discount: 27 },
  { min: 5,  price: 59.99, discount: 20 },
  { min: 2,  price: 64.99, discount: 13 },
  { min: 1,  price: 74.99, discount: 0  },
]
// Flat loyalty rates for active subscribers (mirrors backend CREDIT_PRICE_BY_PLAN)
const CREDIT_PRICE_BY_PLAN: Record<string, number> = {
  starter: 12.99,
  medium:   9.99,
}
function getCreditUnitPrice(qty: number, plan: string | null = null): { price: number; discount: number; isFlat: boolean } {
  if (plan && CREDIT_PRICE_BY_PLAN[plan] !== undefined) {
    const price = CREDIT_PRICE_BY_PLAN[plan]
    const discount = Math.round((1 - price / 74.99) * 100)
    return { price, discount, isFlat: true }
  }
  for (const t of CREDIT_TIERS) {
    if (qty >= t.min) return { price: t.price, discount: t.discount, isFlat: false }
  }
  return { price: 74.99, discount: 0, isFlat: false }
}

// ── Types ──────────────────────────────────────────────────────────────────
interface Job {
  id: string
  filename?: string
  created_at?: string
  status: string
  panel_count?: number
  error_message?: string
}

interface Review {
  id: string
  company?: string
  stars: number
  comment?: string
  created_at?: string
  status?: string
}

interface FhMission {
  id: number
  fh_map_id: string
  fh_map_name?: string
  status: string
  results_uploaded: boolean
  panels_detected?: number
  hotspot_count?: number
  error_msg?: string
  created_at: string
  completed_at?: string
}

interface FhStatus {
  connected: boolean
  workspace_id?: string
  last_sync_at?: string
  missions: FhMission[]
}

// ── Helpers ────────────────────────────────────────────────────────────────
function statusLabel(s: string) {
  const map: Record<string, string> = {
    in_coda: 'In coda',
    taglio_tile: 'Taglio tiles',
    inferenza: 'Inferenza AI',
    completato: 'Completato',
    errore: 'Errore',
  }
  return map[s] || s
}

function statusProgress(s: string) {
  const map: Record<string, number> = {
    in_coda: 5,
    taglio_tile: 25,
    inferenza: 70,
    completato: 100,
    errore: 0,
  }
  return map[s] ?? 10
}

function statusEta(s: string) {
  const map: Record<string, string> = {
    in_coda: '~5 min',
    taglio_tile: '~3 min',
    inferenza: '~1 min',
    completato: 'Completato',
    errore: '',
  }
  return map[s] || ''
}

// ── Drop Zone Component ────────────────────────────────────────────────────
function DropZone({
  label, accept, file, onFile,
}: {
  label: string
  accept: string
  file: File | null
  onFile: (f: File) => void
}) {
  const [dragOver, setDragOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <div
      className={`drop-zone ${dragOver ? 'drag-over' : ''} ${file ? 'has-file' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        const f = e.dataTransfer.files[0]
        if (f) onFile(f)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => { if (e.target.files?.[0]) onFile(e.target.files[0]) }}
      />
      <Upload size={20} style={{ color: file ? '#f59e0b' : '#475569', flexShrink: 0 }} />
      {file ? (
        <span style={{ fontSize: '0.78rem', color: '#f59e0b', fontWeight: 600, wordBreak: 'break-all', textAlign: 'center' }}>
          {file.name}
        </span>
      ) : (
        <>
          <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>Clicca o trascina</span>
        </>
      )}
    </div>
  )
}

// ── Star Rating ────────────────────────────────────────────────────────────
function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          className={`star-btn ${(hover || value) >= n ? 'filled' : ''}`}
          onMouseEnter={() => setHover(n)}
          onMouseLeave={() => setHover(0)}
          onClick={() => onChange(n)}
        >
          <Star size={24} fill={(hover || value) >= n ? '#f59e0b' : 'none'} />
        </button>
      ))}
    </div>
  )
}

// ── Consent Modal ──────────────────────────────────────────────────────────
function EnterpriseConsentModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const [checked, setChecked] = useState(false)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="card"
        style={{ maxWidth: 500, width: '100%', padding: '2rem', borderRadius: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 700 }}>Informativa utilizzo dati</h3>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1.25rem' }}>
          Gli ortomosaici elaborati verranno conservati da SolarDino e potranno essere utilizzati — in forma anonima
          e aggregata — per migliorare e riaddestrare il modello AI. I dati non verranno condivisi con terze parti.
          Puoi richiedere la cancellazione in qualsiasi momento scrivendo a{' '}
          <a href="mailto:agervasini1@gmail.com" style={{ color: '#f59e0b' }}>agervasini1@gmail.com</a>.
          Il trattamento è effettuato nel rispetto del Regolamento (UE) 2016/679 (GDPR).
        </p>
        <label className="flex items-start gap-3 cursor-pointer mb-6">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Ho letto e accetto le condizioni di utilizzo dei dati per il miglioramento del modello AI.
          </span>
        </label>
        <div className="flex gap-3 justify-end">
          <button className="btn-ghost" onClick={onClose}>Annulla</button>
          <button className="btn-amber" disabled={!checked} onClick={onConfirm}>
            <Zap size={15} /> Avvia Elaborazione
          </button>
        </div>
      </motion.div>
    </div>
  )
}

function ConsentModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  const [checked, setChecked] = useState(false)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="card"
        style={{ maxWidth: 500, width: '100%', padding: '2rem', borderRadius: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 700 }}>Consenso al trattamento dati</h3>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: '1.25rem' }}>
          I file che stai per caricare potrebbero contenere dati geografici e informazioni sull'impianto fotovoltaico.
          Questi dati saranno trattati esclusivamente per la generazione del report di analisi termografica e non
          saranno condivisi con terze parti. Il trattamento è effettuato nel rispetto del Regolamento (UE) 2016/679 (GDPR).
        </p>
        <label className="flex items-start gap-3 cursor-pointer mb-6">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
          <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            Ho letto e accetto le condizioni di trattamento dei dati. Confermo di essere autorizzato al caricamento di questi file.
          </span>
        </label>
        <div className="flex gap-3 justify-end">
          <button className="btn-ghost" onClick={onClose}>Annulla</button>
          <button className="btn-amber" disabled={!checked} onClick={onConfirm}>
            <Zap size={15} /> Avvia elaborazione
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ── Change Password Modal ──────────────────────────────────────────────────
function ChangeEmailModal({ onClose }: { onClose: () => void }) {
  const [newEmail, setNewEmail] = useState('')
  const [pwd, setPwd] = useState('')
  const [msg, setMsg] = useState('')
  const [success, setSuccess] = useState(false)

  async function changeEmail() {
    try {
      const res = await apiFetch('/auth/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_email: newEmail, password: pwd }),
      })
      if (res.ok) {
        setSuccess(true)
        setMsg('Email di verifica inviata. Controlla la nuova casella e clicca il link.')
        setTimeout(() => onClose(), 3000)
      } else {
        const err = await res.json().catch(() => ({}))
        setMsg(err.detail || 'Errore aggiornamento email')
      }
    } catch { setMsg('Errore di connessione') }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="card"
        style={{ maxWidth: 420, width: '100%', padding: '2rem', borderRadius: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Mail size={18} style={{ color: '#f59e0b' }} /> Cambia email
          </h3>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
        </div>

        {success ? (
          <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)' }}>
            <Check size={32} style={{ color: '#34d399', margin: '0 auto 8px' }} />
            <p style={{ color: '#34d399', fontWeight: 600 }}>{msg}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {msg && (
              <div className="rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: '0.875rem' }}>
                {msg}
              </div>
            )}
            <input className="form-input" type="email" placeholder="Nuova email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <input className="form-input" type="password" placeholder="Password attuale (conferma)" value={pwd} onChange={(e) => setPwd(e.target.value)} />
            <button className="btn-amber w-full mt-1" style={{ padding: '0.7rem' }} onClick={changeEmail}>
              Invia email di verifica
            </button>
          </div>
        )}
      </motion.div>
    </div>
  )
}

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState('')
  const [success, setSuccess] = useState(false)

  async function changePassword() {
    try {
      const res = await apiFetch('/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
      })
      if (res.ok) {
        setSuccess(true)
        setMsg('Password aggiornata con successo!')
        setTimeout(() => onClose(), 2000)
      } else {
        const err = await res.json().catch(() => ({}))
        setMsg(err.detail || 'Errore aggiornamento password')
        setConfirm(false)
      }
    } catch { setMsg('Errore di connessione') }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="card"
        style={{ maxWidth: 420, width: '100%', padding: '2rem', borderRadius: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 style={{ color: 'var(--text-primary)', fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Lock size={18} style={{ color: '#f59e0b' }} /> Cambia password
          </h3>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
        </div>

        {success ? (
          <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(52,211,153,0.1)', border: '1px solid rgba(52,211,153,0.3)' }}>
            <Check size={32} style={{ color: '#34d399', margin: '0 auto 8px' }} />
            <p style={{ color: '#34d399', fontWeight: 600 }}>{msg}</p>
          </div>
        ) : msg && !confirm ? (
          <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#ef4444', fontSize: '0.875rem' }}>
            {msg}
          </div>
        ) : null}

        {!success && !confirm && (
          <div className="flex flex-col gap-3">
            <input
              className="form-input"
              type="password"
              placeholder="Password attuale"
              value={oldPwd}
              onChange={(e) => setOldPwd(e.target.value)}
            />
            <input
              className="form-input"
              type="password"
              placeholder="Nuova password (min. 8 caratteri)"
              value={newPwd}
              onChange={(e) => setNewPwd(e.target.value)}
            />
            <button
              className="btn-amber w-full mt-1"
              style={{ padding: '0.7rem' }}
              onClick={() => { if (oldPwd && newPwd.length >= 8) setConfirm(true) }}
            >
              Aggiorna password
            </button>
          </div>
        )}

        {!success && confirm && (
          <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}>Sei sicuro di voler cambiare la password?</p>
            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
              Questa operazione è irreversibile.
            </p>
            <div className="flex gap-2">
              <button className="btn-ghost" style={{ flex: 1 }} onClick={() => setConfirm(false)}>Annulla</button>
              <button className="btn-amber" style={{ flex: 1 }} onClick={changePassword}>Confermo</button>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  )
}

// ── IP Warning Modal ────────────────────────────────────────────────────────
function IpWarningModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        transition={{ duration: 0.2 }}
        className="card"
        style={{ maxWidth: 440, width: '100%', padding: '2rem', borderRadius: 20 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ color: '#ef4444', fontSize: '1.1rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <AlertTriangle size={20} style={{ color: '#ef4444' }} /> Accesso limitato
          </h3>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1rem' }}>
          Il tuo indirizzo IP è già associato ad un altro account su SolarDino.
          Per questo motivo il tuo account non ha diritto a:
        </p>
        <ul style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', paddingLeft: '1.25rem', marginBottom: '1.25rem', lineHeight: 2 }}>
          <li>Crediti bonus di benvenuto</li>
          <li>Nessun abbonamento ereditato</li>
          <li>Nessun bonus promozionale</li>
        </ul>
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
          Se pensi sia un errore, contatta <a href="mailto:agervasini1@gmail.com" style={{ color: '#f59e0b' }}>agervasini1@gmail.com</a>.
        </p>
        <button className="btn-amber w-full" onClick={onClose}>Ho capito</button>
      </motion.div>
    </div>
  )
}

// ── Info Modal ─────────────────────────────────────────────────────────────
// ── Profile Sidebar ────────────────────────────────────────────────────────

function ProfileSidebar({
  name, email, ragioneSociale, history, downloadFile, myReview, onReviewUpdate, onClose, isDark, onToggleTheme, onRequestDelete, subscriptionActive, subscriptionPlan, subscriptionEndDate, subscriptionCancelled, onChangePassword, onChangeEmail,
}: {
  name: string
  email: string
  ragioneSociale: string
  history: Job[]
  downloadFile: (jobId: string, format: string) => void
  myReview: Review | null
  onReviewUpdate: (r: Review) => void
  onClose: () => void
  isDark: boolean
  onToggleTheme: () => void
  onRequestDelete: () => void
  subscriptionActive: boolean
  subscriptionPlan: string | null
  subscriptionEndDate: string | null
  subscriptionCancelled: boolean
  onChangePassword: () => void
  onChangeEmail: () => void
}) {
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [selectedHistoryJob, setSelectedHistoryJob] = useState<Job | null>(null)
  const [inputFiles, setInputFiles] = useState<{name: string; url: string; size_mb: number}[] | null>(null)
  const [inputFilesLoading, setInputFilesLoading] = useState(false)
  const [msg] = useState('')
  const [editStars, setEditStars] = useState(myReview?.stars ?? 0)
  const [editComment, setEditComment] = useState(myReview?.comment ?? '')
  const [reviewMsg, setReviewMsg] = useState('')
  const [subMsg, setSubMsg] = useState('')
  const [showCancelSubModal, setShowCancelSubModal] = useState(false)

  useEffect(() => {
    if (myReview) {
      setEditStars(myReview.stars)
      setEditComment(myReview.comment ?? '')
    }
  }, [myReview])

  useEffect(() => {
    if (!selectedHistoryJob) { setInputFiles(null); return }
    setInputFilesLoading(true)
    apiFetch(`/missions/${selectedHistoryJob.id}/input-files`)
      .then((r) => r.ok ? r.json() : [])
      .then((d) => setInputFiles(Array.isArray(d) ? d : []))
      .catch(() => setInputFiles([]))
      .finally(() => setInputFilesLoading(false))
  }, [selectedHistoryJob?.id])

  function toggle(s: string) {
    setOpenSection((prev) => (prev === s ? null : s))
  }

  async function updateReview() {
    if (!editStars) { setReviewMsg('Seleziona una valutazione'); return }
    try {
      const method = myReview ? 'PUT' : 'POST'
      const url = myReview ? `/reviews/${myReview.id}` : '/reviews'
      const res = await apiFetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars: editStars, comment: editComment }),
      })
      if (res.ok) {
        const updated = await res.json()
        onReviewUpdate(updated)
        setReviewMsg('Recensione aggiornata!')
        setTimeout(() => setReviewMsg(''), 3000)
      } else {
        setReviewMsg('Errore aggiornamento')
      }
    } catch { setReviewMsg('Errore') }
  }


  async function cancelSubscription() {
    setShowCancelSubModal(false)
    try {
      const res = await apiFetch('/payments/cancel-subscription', { method: 'POST' })
      if (res.ok) {
        setSubMsg('Abbonamento cancellato. Non verrà rinnovato alla scadenza.')
      } else {
        const err = await res.json().catch(() => ({}))
        setSubMsg(err.detail || 'Errore durante la cancellazione.')
      }
    } catch { setSubMsg('Errore di rete') }
    setTimeout(() => setSubMsg(''), 5000)
  }

  async function logout() {
    await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
    localStorage.clear()
    window.location.href = '/login'
  }

  const initials = name ? name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) : '??'

  const st = isDark ? {
    bg: '#0d1117', border: 'rgba(255,255,255,0.08)', borderSub: 'rgba(255,255,255,0.06)',
    text: '#f1f5f9', textSec: '#94a3b8', textMuted: '#64748b',
    rowBg: 'rgba(255,255,255,0.03)', rowBorder: 'rgba(255,255,255,0.06)',
  } : {
    bg: '#ffffff', border: 'rgba(0,0,0,0.1)', borderSub: 'rgba(0,0,0,0.07)',
    text: '#1e293b', textSec: '#475569', textMuted: '#94a3b8',
    rowBg: 'rgba(0,0,0,0.03)', rowBorder: 'rgba(0,0,0,0.07)',
  }

  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
        onClick={onClose}
      />
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 260 }}
        className="fixed right-0 top-0 bottom-0 z-50 flex flex-col"
        style={{
          width: 360,
          background: st.bg,
          borderLeft: `1px solid ${st.border}`,
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ padding: '1.5rem', borderBottom: `1px solid ${st.border}` }}>
          <div className="flex items-center justify-between mb-4">
            <span style={{ color: st.textSec, fontSize: '0.875rem', fontWeight: 600 }}>Profilo</span>
            <div className="flex items-center gap-2">
              <button
                onClick={onToggleTheme}
                className="btn-ghost flex items-center gap-1.5"
                style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                title={isDark ? 'Modalità chiara' : 'Modalità scura'}
              >
                {isDark ? <Sun size={14} /> : <Moon size={14} />}
                {isDark ? 'Chiara' : 'Scura'}
              </button>
              <button onClick={onClose} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div
              className="flex items-center justify-center rounded-full flex-shrink-0"
              style={{ width: 52, height: 52, background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#000', fontWeight: 700, fontSize: '1.1rem' }}
            >
              {initials}
            </div>
            <div>
              <div style={{ color: st.text, fontWeight: 600, fontSize: '0.975rem' }}>{name}</div>
              <div style={{ color: st.textMuted, fontSize: '0.8rem' }}>{email}</div>
            </div>
          </div>
        </div>

        {/* Accordion */}
        <div style={{ flex: 1, padding: '1rem' }}>
          {msg && (
            <div className="rounded-xl p-3 mb-3" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b', fontSize: '0.8rem' }}>
              {msg}
            </div>
          )}

          {/* Banner scadenza abbonamento */}
          {subscriptionActive && subscriptionEndDate && (
            <div className="mb-2 rounded-xl px-4 py-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)' }}>
              <div style={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 3 }}>
                Abbonamento attivo
              </div>
              <div style={{ fontSize: '0.82rem', color: isDark ? '#f1f5f9' : '#1e293b', fontWeight: 600 }}>
                {subscriptionPlan === 'starter' ? 'Starter'
                  : subscriptionPlan === 'medium' ? 'Medium'
                  : subscriptionPlan === 'unlimited' ? 'Unlimited'
                  : subscriptionPlan === 'unlimited_annual' ? 'Annual'
                  : subscriptionPlan ?? '—'}
              </div>
              <div style={{ fontSize: '0.75rem', color: isDark ? '#94a3b8' : '#64748b', marginTop: 2 }}>
                Scade il <span style={{ fontWeight: 600, color: isDark ? '#f1f5f9' : '#334155' }}>{subscriptionEndDate}</span>
              </div>
            </div>
          )}

          {/* Info azienda */}
          <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
            <button
              className="w-full flex items-center justify-between p-4"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: st.text }}
              onClick={() => toggle('info')}
            >
              <span className="flex items-center gap-2 text-sm font-medium"><Building2 size={15} /> Info azienda</span>
              <ChevronRight size={15} style={{ transform: openSection === 'info' ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: st.textMuted }} />
            </button>
            {openSection === 'info' && (
              <div style={{ padding: '0 1rem 1rem', borderTop: `1px solid ${st.borderSub}` }}>
                <div className="flex flex-col gap-2" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
                  {[
                    { label: 'Ragione sociale', value: ragioneSociale || '—' },
                    { label: 'Nome', value: name || '—' },
                    { label: 'Email', value: email || '—' },
                    { label: 'Password', value: '••••••••' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ padding: '0.6rem 0.75rem', background: st.rowBg, borderRadius: 10, border: `1px solid ${st.rowBorder}` }}>
                      <div style={{ fontSize: '0.68rem', color: st.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: '0.85rem', color: label === 'Password' ? st.textMuted : st.text, fontWeight: 500 }}>{value}</div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '0.75rem', color: st.textMuted, marginBottom: '0.75rem' }}>
                  Per modificare email o password usa le sezioni dedicate. Per altri dati contatta il supporto.
                </p>
                <button
                  className="flex items-center gap-2"
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}
                  onClick={() => { onClose(); onRequestDelete() }}
                >
                  <Trash2 size={13} /> Elimina account
                </button>
              </div>
            )}
          </div>

          {/* Cambia email */}
          <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
            <button
              className="w-full flex items-center justify-between p-4"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: st.text }}
              onClick={onChangeEmail}
            >
              <span className="flex items-center gap-2 text-sm font-medium"><Mail size={15} /> Cambia email</span>
              <ChevronRight size={15} style={{ color: st.textMuted }} />
            </button>
          </div>

          {/* Cambia password */}
          <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
            <button
              className="w-full flex items-center justify-between p-4"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: st.text }}
              onClick={onChangePassword}
            >
              <span className="flex items-center gap-2 text-sm font-medium"><Lock size={15} /> Cambia password</span>
              <ChevronRight size={15} style={{ color: st.textMuted }} />
            </button>
          </div>

          {/* Storico elaborazioni */}
          <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
            <button
              className="w-full flex items-center justify-between p-4"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: st.text }}
              onClick={() => toggle('storico')}
            >
              <span className="flex items-center gap-2 text-sm font-medium"><History size={15} /> Storico elaborazioni</span>
              <ChevronRight size={15} style={{ transform: openSection === 'storico' ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: st.textMuted }} />
            </button>
            {openSection === 'storico' && (
              <div style={{ padding: '0 1rem 1rem', borderTop: `1px solid ${st.borderSub}` }}>
                {history.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center', padding: '1rem 0' }}>
                    Nessuna elaborazione ancora.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 mt-3">
                    {history.map((job) => (
                      <div
                        key={job.id}
                        onClick={() => setSelectedHistoryJob(job)}
                        style={{ padding: '0.65rem 0.75rem', background: st.rowBg, borderRadius: 10, border: `1px solid ${st.rowBorder}`, cursor: 'pointer' }}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span style={{ fontSize: '0.78rem', color: st.text, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                            {job.filename || `Job ${job.id.slice(0, 8)}`}
                          </span>
                          <span className={`badge ${job.status === 'completato' ? 'badge-green' : job.status === 'errore' ? 'badge-red' : 'badge-amber'}`} style={{ fontSize: '0.65rem' }}>
                            {statusLabel(job.status)}
                          </span>
                        </div>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                          {job.created_at ? new Date(job.created_at).toLocaleDateString('it-IT') : '—'}
                          {job.panel_count != null ? ` · ${job.panel_count} pannelli` : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Popup dettaglio elaborazione */}
            {selectedHistoryJob && (
              <div
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
                onClick={() => setSelectedHistoryJob(null)}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{ background: st.bg, border: `1px solid ${st.border}`, borderRadius: 18, padding: '1.5rem', width: '100%', maxWidth: 400, boxShadow: '0 20px 60px rgba(0,0,0,0.4)' }}
                >
                  <div className="flex items-center justify-between mb-4">
                    <span style={{ fontWeight: 700, fontSize: '0.95rem', color: st.text }}>
                      {selectedHistoryJob.filename || `Elaborazione ${selectedHistoryJob.id.slice(0, 8)}`}
                    </span>
                    <button onClick={() => setSelectedHistoryJob(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: st.textMuted, fontSize: '1.2rem', lineHeight: 1 }}>×</button>
                  </div>

                  <div style={{ fontSize: '0.75rem', color: st.textMuted, marginBottom: '1.2rem' }}>
                    {selectedHistoryJob.created_at ? new Date(selectedHistoryJob.created_at).toLocaleDateString('it-IT', { day: '2-digit', month: 'long', year: 'numeric' }) : ''}
                    {selectedHistoryJob.panel_count != null ? ` · ${selectedHistoryJob.panel_count} pannelli rilevati` : ''}
                  </div>

                  {/* Input */}
                  <div style={{ marginBottom: '1rem' }}>
                    <p style={{ fontSize: '0.75rem', fontWeight: 600, color: st.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>📥 File di input</p>
                    {inputFilesLoading ? (
                      <div style={{ fontSize: '0.78rem', color: st.textMuted, padding: '0.4rem 0' }}>Caricamento...</div>
                    ) : inputFiles && inputFiles.length > 0 ? (
                      <div className="flex flex-col gap-1">
                        {inputFiles.map((f) => (
                          <a
                            key={f.name}
                            href={f.url}
                            download={f.name}
                            className="btn-ghost w-full"
                            style={{ fontSize: '0.82rem', padding: '0.5rem', justifyContent: 'center', textDecoration: 'none', display: 'block', textAlign: 'center' }}
                          >
                            {f.name}{f.size_mb > 0 ? ` (${f.size_mb} MB)` : ''}
                          </a>
                        ))}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.78rem', color: st.textMuted }}>Nessun file di input disponibile.</div>
                    )}
                  </div>

                  {/* Output */}
                  {selectedHistoryJob.status === 'completato' && (
                    <div>
                      <p style={{ fontSize: '0.75rem', fontWeight: 600, color: st.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>📤 File di output</p>
                      <div className="flex flex-col gap-1">
                        {['kml', 'kmz', 'json', 'csv', 'geojson'].map((fmt) => (
                          <button
                            key={fmt}
                            className="btn-ghost w-full"
                            style={{ fontSize: '0.82rem', padding: '0.5rem', justifyContent: 'center', textTransform: 'uppercase' }}
                            onClick={() => downloadFile(selectedHistoryJob.id, fmt)}
                          >
                            {fmt}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          {/* Gestione Team — rimossa dalla sidebar, ora nella navbar (icona Users) */}

          {/* Modifica recensione */}
          {myReview && (
            <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
              <button
                className="w-full flex items-center justify-between p-4"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: st.text }}
                onClick={() => toggle('recensione')}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <Star size={15} /> Modifica recensione
                </span>
                <ChevronRight size={15} style={{ transform: openSection === 'recensione' ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: st.textMuted }} />
              </button>
              {openSection === 'recensione' && (
                <div style={{ padding: '0 1rem 1rem', borderTop: `1px solid ${st.borderSub}` }}>
                  <div className="mt-3 mb-3">
                    <label className="form-label">La tua valutazione</label>
                    <StarRating value={editStars} onChange={setEditStars} />
                  </div>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="Commento (opzionale)"
                    value={editComment}
                    onChange={(e) => setEditComment(e.target.value)}
                    style={{ resize: 'vertical', fontSize: '0.85rem' }}
                  />
                  {reviewMsg && (
                    <div className="rounded-xl p-2 mt-2" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', fontSize: '0.78rem' }}>
                      {reviewMsg}
                    </div>
                  )}
                  <button className="btn-amber w-full mt-3" style={{ fontSize: '0.85rem', padding: '0.6rem' }} onClick={updateReview}>
                    <Check size={14} /> Salva modifiche
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Gestione abbonamento — visibile solo se abbonamento attivo */}
          {subscriptionActive && (
            <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
              <button
                className="w-full flex items-center justify-between p-4"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: st.text }}
                onClick={() => toggle('abbonamento')}
              >
                <span className="flex items-center gap-2 text-sm font-medium"><CreditCard size={15} /> Gestione abbonamento</span>
                <ChevronRight size={15} style={{ transform: openSection === 'abbonamento' ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: st.textMuted }} />
              </button>
              {openSection === 'abbonamento' && (
                <div style={{ padding: '0 1rem 1rem', borderTop: `1px solid ${st.borderSub}` }}>
                  <p style={{ fontSize: '0.78rem', color: st.textSec, marginTop: '0.75rem', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                    Puoi gestire o disdire il tuo abbonamento direttamente dal portale Stripe.
                  </p>
                  {subMsg && (
                    <div className="rounded-xl p-2 mb-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: '0.78rem' }}>
                      {subMsg}
                    </div>
                  )}
                  {subscriptionCancelled ? (
                    <div style={{ fontSize: '0.78rem', color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, padding: '0.6rem 0.75rem', lineHeight: 1.5 }}>
                      ⚠️ Rinnovo automatico disattivato. I benefici restano attivi fino alla scadenza.
                    </div>
                  ) : (
                    <button
                      className="btn-ghost w-full"
                      style={{ fontSize: '0.85rem', padding: '0.6rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }}
                      onClick={() => setShowCancelSubModal(true)}
                    >
                      Annulla abbonamento
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Logout */}
        <div style={{ padding: '1rem', borderTop: `1px solid ${st.border}` }}>
          <button
            className="w-full flex items-center justify-center gap-2 btn-ghost"
            style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)', width: '100%' }}
            onClick={logout}
          >
            <LogOut size={15} /> Esci dall'account
          </button>
        </div>
      </motion.div>

      {/* Modal conferma cancellazione abbonamento */}
      {showCancelSubModal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}
          onClick={() => setShowCancelSubModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{ background: isDark ? '#0d1117' : '#fff', border: `1px solid ${isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)'}`, borderRadius: 20, padding: '1.75rem', width: '100%', maxWidth: 400 }}
          >
            <div style={{ fontSize: '1.05rem', fontWeight: 700, color: isDark ? '#f1f5f9' : '#1e293b', marginBottom: 10 }}>
              Annullare l'abbonamento?
            </div>
            <p style={{ fontSize: '0.85rem', color: isDark ? '#94a3b8' : '#64748b', lineHeight: 1.6, marginBottom: 6 }}>
              Non ti verranno addebitati costi per il rinnovo.{' '}
              {subscriptionEndDate
                ? <>Manterrai i crediti rimasti fino al <strong style={{ color: isDark ? '#f1f5f9' : '#1e293b' }}>{subscriptionEndDate}</strong>.</>
                : 'Manterrai i crediti rimasti fino alla scadenza.'}
            </p>
            <p style={{ fontSize: '0.78rem', color: '#f59e0b', marginBottom: '1.25rem', lineHeight: 1.5 }}>
              ⚠️ L'abbonamento è condiviso tra tutti gli account del tuo team. Annullarlo rimuoverà il rinnovo automatico per tutta l'azienda.
            </p>
            <div className="flex gap-3">
              <button
                className="btn-ghost flex-1"
                style={{ fontSize: '0.875rem', padding: '0.65rem' }}
                onClick={() => setShowCancelSubModal(false)}
              >
                Torna indietro
              </button>
              <button
                className="btn-ghost flex-1"
                style={{ fontSize: '0.875rem', padding: '0.65rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)' }}
                onClick={cancelSubscription}
              >
                Sì, annulla
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ── Support Card ────────────────────────────────────────────────────────────
interface TicketListItem { id: number; subject: string; status: string; created_at: string }

function statusBadge(s: string) {
  if (s === 'risolto') return { label: 'Chiuso',          bg: 'rgba(100,116,139,0.15)', color: '#94a3b8' }
  return                      { label: 'In elaborazione', bg: 'rgba(245,158,11,0.1)',  color: '#f59e0b' }
}

function SupportCard({ onOpenTicket, refreshKey }: { onOpenTicket: (id: number) => void; refreshKey: number }) {
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [tickets, setTickets] = useState<TicketListItem[]>([])
  const [showNewForm, setShowNewForm] = useState(false)
  const [ticketFilter, setTicketFilter] = useState<'elaborazione' | 'chiuse'>('elaborazione')

  useEffect(() => {
    apiFetch('/auth/tickets')
      .then((r) => r.ok ? r.json() : [])
      .then((d) => { if (Array.isArray(d)) setTickets(d) })
      .catch(() => {})
  }, [refreshKey])

  async function send() {
    if (!subject.trim() || !message.trim()) return
    setSending(true)
    setResult(null)
    try {
      const res = await apiFetch('/auth/support', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subject: subject.trim(), message: message.trim() }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        const ticketId = d.ticket_id || d.id
        const successText = ticketId
          ? `Richiesta #${ticketId} inviata con successo.`
          : (d.message || 'Richiesta inviata con successo.')
        setResult({ ok: true, text: successText })
        setSubject('')
        setMessage('')
        setShowNewForm(false)
        // Ricarica lista ticket
        apiFetch('/auth/tickets').then((r) => r.ok ? r.json() : []).then((dl) => { if (Array.isArray(dl)) setTickets(dl) }).catch(() => {})
      } else {
        setResult({ ok: false, text: d.detail || 'Errore durante l\'invio.' })
      }
    } catch {
      setResult({ ok: false, text: 'Errore di rete.' })
    }
    setSending(false)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="card mb-8"
    >
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
            <Mail size={17} />
          </div>
          <div>
            <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Segnalazioni</h2>
            <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>Il nostro team risponde entro 24h</div>
          </div>
        </div>
        <button
          className="btn-amber"
          style={{ fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
          onClick={() => { setShowNewForm((v) => !v); setResult(null) }}
        >
          {showNewForm ? 'Annulla' : '+ Nuova segnalazione'}
        </button>
      </div>

      {/* Filtri stato */}
      {tickets.length > 0 && (
        <div className="flex gap-1 mb-4" style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 10, padding: 3, display: 'inline-flex' }}>
          {(['elaborazione', 'chiuse'] as const).map((f) => (
            <button key={f} onClick={() => setTicketFilter(f)}
              style={{ background: ticketFilter === f ? 'rgba(245,158,11,0.15)' : 'transparent', border: ticketFilter === f ? '1px solid rgba(245,158,11,0.3)' : '1px solid transparent', color: ticketFilter === f ? '#f59e0b' : '#64748b', borderRadius: 8, padding: '0.3rem 0.9rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
              {f === 'elaborazione'
                ? `In elaborazione (${tickets.filter((t) => t.status !== 'risolto').length})`
                : `Chiuse (${tickets.filter((t) => t.status === 'risolto').length})`}
            </button>
          ))}
        </div>
      )}

      {/* Lista ticket per mese */}
      {tickets.length > 0 && (() => {
        const filtered = tickets.filter((t) => ticketFilter === 'chiuse' ? t.status === 'risolto' : t.status !== 'risolto')
        const byMonth: Record<string, TicketListItem[]> = {}
        filtered.forEach((t) => {
          const key = new Date(t.created_at).toLocaleDateString('it-IT', { month: 'long', year: 'numeric' })
          if (!byMonth[key]) byMonth[key] = []
          byMonth[key].push(t)
        })
        const months = Object.keys(byMonth).sort((a, b) =>
          new Date(byMonth[b][0].created_at).getTime() - new Date(byMonth[a][0].created_at).getTime()
        )
        if (months.length === 0) return (
          <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
            Nessuna segnalazione {ticketFilter === 'chiuse' ? 'chiusa' : 'in elaborazione'}.
          </p>
        )
        return (
          <div className="flex flex-col gap-4 mb-4">
            {months.map((month) => (
              <div key={month}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: 700, color: '#f59e0b', textTransform: 'capitalize' }}>{month}</span>
                  <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{byMonth[month].length} segnalazioni</span>
                </div>
                <div className="flex flex-col gap-1">
                  {byMonth[month].map((t) => {
                    const badge = statusBadge(t.status)
                    const isClosed = t.status === 'risolto'
                    return (
                      <button key={t.id} onClick={() => onOpenTicket(t.id)}
                        style={{ width: '100%', background: isClosed ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.03)', border: `1px solid ${isClosed ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.07)'}`, borderRadius: 10, padding: '0.65rem 0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, textAlign: 'left', opacity: isClosed ? 0.75 : 1 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{t.id} — {t.subject}</div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 1 }}>{new Date(t.created_at).toLocaleDateString('it-IT')}</div>
                        </div>
                        <span style={{ flexShrink: 0, background: badge.bg, color: badge.color, fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{badge.label}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )
      })()}

      {tickets.length === 0 && !showNewForm && (
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
          Nessuna segnalazione ancora. Usa il tasto in alto per aprirne una nuova.
        </p>
      )}

      {/* Form nuova segnalazione */}
      <AnimatePresence>
        {showNewForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: '1rem' }} className="flex flex-col gap-3">
              <div>
                <label className="form-label">Oggetto</label>
                <input
                  className="form-input"
                  placeholder="Es: problema con il download dei risultati"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  maxLength={120}
                />
              </div>
              <div>
                <label className="form-label">Messaggio</label>
                <textarea
                  className="form-input"
                  rows={4}
                  placeholder="Descrivi il problema o la richiesta nel dettaglio..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  maxLength={5000}
                  style={{ resize: 'vertical' }}
                />
              </div>
              {result && (
                <div
                  className="rounded-xl p-3"
                  style={{
                    background: result.ok ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)',
                    border: `1px solid ${result.ok ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
                    color: result.ok ? '#22c55e' : '#ef4444',
                    fontSize: '0.85rem',
                  }}
                >
                  {result.text}
                </div>
              )}
              <button
                className="btn-amber"
                style={{ alignSelf: 'flex-start' }}
                disabled={sending || !subject.trim() || !message.trim()}
                onClick={send}
              >
                <Mail size={15} /> {sending ? 'Invio...' : 'Invia richiesta'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  // User state — caricato da /auth/me, niente in localStorage
  const [userName, setUserName] = useState('')
  const [userEmail, setUserEmail] = useState('')
  const [credits, setCredits] = useState(0)
  const [ragioneSociale, setRagioneSociale] = useState('')
  const [subscriptionActive, setSubscriptionActive] = useState(false)
  const [subscriptionPlan, setSubscriptionPlan] = useState<string | null>(null)
  const [subscriptionEndDate, setSubscriptionEndDate] = useState<string | null>(null)
  const [subscriptionCancelled, setSubscriptionCancelled] = useState(false)
  // Bell notifications (C)
  const [notifications, setNotifications] = useState<{id: number; title: string; message: string; is_read: boolean; ticket_id: number | null; created_at: string}[]>([])
  const [showBellDropdown, setShowBellDropdown] = useState(false)
  const bellRef = useRef<HTMLDivElement>(null)

  // Ticket conversation modal
  interface TicketMsg { id: number; sender: string; text: string; created_at: string }
  interface TicketDetail { id: number; subject: string; status: string; created_at: string; messages: TicketMsg[] }
  const [showTicketModal, setShowTicketModal] = useState(false)
  const [ticketDetail, setTicketDetail] = useState<TicketDetail | null>(null)
  const [ticketReplyText, setTicketReplyText] = useState('')
  const [ticketReplyLoading, setTicketReplyLoading] = useState(false)
  const [ticketActionMsg, setTicketActionMsg] = useState('')
  const [clientClosedTicketIds, setClientClosedTicketIds] = useState<Set<number>>(new Set())
  const [ticketRefreshKey, setTicketRefreshKey] = useState(0)

  // Delete account confirm modal (E)
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  // Change password modal
  const [showChangePwdModal, setShowChangePwdModal] = useState(false)
  const [showChangeEmailModal, setShowChangeEmailModal] = useState(false)
  // IP warning modal — show once on load if ip is flagged
  const [showIpModal, setShowIpModal] = useState(() => {
    const v = sessionStorage.getItem('show_ip_warning') === 'true'
    if (v) sessionStorage.removeItem('show_ip_warning')
    return v
  })

  // Theme state
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') !== 'light')

  useEffect(() => {
    const root = document.documentElement
    if (isDark) {
      root.style.setProperty('--bg', '#060912')
      root.style.setProperty('--border', 'rgba(255,255,255,0.07)')
      root.style.setProperty('--surface', 'rgba(255,255,255,0.03)')
      root.style.setProperty('--surface-hover', 'rgba(255,255,255,0.06)')
      root.style.setProperty('--text-primary', '#f1f5f9')
      root.style.setProperty('--text-secondary', '#94a3b8')
      root.style.setProperty('--text-muted', '#64748b')
      root.style.setProperty('--navbar-bg', 'rgba(6,9,18,0.85)')
      root.style.setProperty('--navbar-border', 'rgba(255,255,255,0.07)')
      root.style.setProperty('--grid-line', 'rgba(255,255,255,0.018)')
      root.style.setProperty('--scrollbar-track', 'rgba(255,255,255,0.03)')
      root.style.setProperty('--scrollbar-thumb', 'rgba(255,255,255,0.12)')
      root.style.setProperty('--scrollbar-thumb-hover', 'rgba(255,255,255,0.2)')
      localStorage.setItem('theme', 'dark')
    } else {
      root.style.setProperty('--bg', '#f0f4f8')
      root.style.setProperty('--border', 'rgba(0,0,0,0.09)')
      root.style.setProperty('--surface', 'rgba(0,0,0,0.03)')
      root.style.setProperty('--surface-hover', 'rgba(0,0,0,0.06)')
      root.style.setProperty('--text-primary', '#0f172a')
      root.style.setProperty('--text-secondary', '#475569')
      root.style.setProperty('--text-muted', '#94a3b8')
      root.style.setProperty('--navbar-bg', 'rgba(240,244,248,0.92)')
      root.style.setProperty('--navbar-border', 'rgba(0,0,0,0.08)')
      root.style.setProperty('--grid-line', 'rgba(0,0,0,0.04)')
      root.style.setProperty('--scrollbar-track', 'rgba(0,0,0,0.03)')
      root.style.setProperty('--scrollbar-thumb', 'rgba(0,0,0,0.12)')
      root.style.setProperty('--scrollbar-thumb-hover', 'rgba(0,0,0,0.2)')
      localStorage.setItem('theme', 'light')
    }
  }, [isDark])

  function toggleTheme() { setIsDark((d) => !d) }

  // UI state
  const [showProfile, setShowProfile] = useState(false)

  // Upload state
  const [thermalTif, setThermalTif] = useState<File | null>(null)
  const [thermalTfw, setThermalTfw] = useState<File | null>(null)
  const [rgbTif, setRgbTif] = useState<File | null>(null)
  const [rgbTfw, setRgbTfw] = useState<File | null>(null)
  const [panelData, setPanelData] = useState({ marca: '', modello: '', dimensioni: '', efficienza: '', coefficiente: '' })
  const [showConsent, setShowConsent] = useState(false)
  const [showEnterpriseConsent, setShowEnterpriseConsent] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const [showBlocked, setShowBlocked] = useState(false)

  // Job polling
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // History
  const [history, setHistory] = useState<Job[]>([])


  // Reviews
  const [myReview, setMyReview] = useState<Review | null>(null)
  const [starValue, setStarValue] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewMsg, setReviewMsg] = useState('')

  // Modalità elaborazione
  const [strada, setStrada] = useState<'A' | 'B' | null>(null)

  // FlightHub 2
  const [fhStatus, setFhStatus] = useState<FhStatus>({ connected: false, missions: [] })
  const [showFhModal, setShowFhModal] = useState(false)
  const [fhForm, setFhForm] = useState({ workspace_id: '', client_id: '', client_secret: '' })
  const [fhMsg, setFhMsg] = useState('')
  const [fhSyncing, setFhSyncing] = useState(false)

  // ── Load user data ─────────────────────────────────────────────────────
  function loadData() {
    apiFetch('/auth/me')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => {
        if (!d) return
        setUserName(d.name || d.user?.name || userName)
        setUserEmail(d.email || d.user?.email || userEmail)
        const c = d.credits ?? d.user?.credits ?? credits
        setCredits(c)
        if (d.ragione_sociale) setRagioneSociale(d.ragione_sociale)
        if (d.subscription_active !== undefined) setSubscriptionActive(!!d.subscription_active)
        if (d.subscription_plan !== undefined) setSubscriptionPlan(d.subscription_plan ?? null)
        if (d.subscription_end_date !== undefined) setSubscriptionEndDate(d.subscription_end_date ?? null)
        if (d.subscription_cancelled !== undefined) setSubscriptionCancelled(!!d.subscription_cancelled)
      })
      .catch(() => {})

    // Load notifications for bell (C)
    apiFetch('/auth/notifications')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (Array.isArray(d)) setNotifications(d) })
      .catch(() => {})

    apiFetch('/missions/history')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setHistory(Array.isArray(d) ? d : d.missions || []) })
      .catch(() => {})


    apiFetch('/reviews/mine')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d && d.id) setMyReview(d) })
      .catch(() => {})

    apiFetch('/flighthub/status')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d) setFhStatus(d) })
      .catch(() => {})

  }

  useEffect(() => {
    loadData()
    const interval = setInterval(loadData, 30_000)
    return () => clearInterval(interval)
  }, [])

  // Close bell dropdown on outside click (C)
  useEffect(() => {
    if (!showBellDropdown) return
    function handleClick(e: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(e.target as Node)) {
        setShowBellDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showBellDropdown])

  // ── Job polling ────────────────────────────────────────────────────────
  const startPolling = useCallback((jobId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const r = await apiFetch(`/missions/${jobId}/status`)
        const d = await r.json()
        setActiveJob(d)
        if (d.status === 'completato' || d.status === 'errore') {
          clearInterval(pollRef.current!)
          // Su errore mantieni il job visibile così l'utente può scaricare il log
          if (d.status === 'completato') setActiveJob(null)
          // Refresh history & credits
          apiFetch('/missions/history')
            .then((r) => r.json())
            .then((hd) => setHistory(Array.isArray(hd) ? hd : hd.missions || []))
            .catch(() => {})
          apiFetch('/auth/me')
            .then((r) => r.json())
            .then((ud) => {
              const c = ud.credits ?? ud.user?.credits ?? credits
              setCredits(c)
            })
            .catch(() => {})
        }
      } catch { clearInterval(pollRef.current!) }
    }, 3000)
  }, [credits])

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  // ── Upload ─────────────────────────────────────────────────────────────
  async function doUpload() {
    if (!thermalTif) { setUploadError('File Termico TIF obbligatorio'); return }
    setUploading(true)
    setUploadError('')
    try {
      const fd = new FormData()
      fd.append('thermal_tif', thermalTif)
      if (thermalTfw) fd.append('thermal_tfw', thermalTfw)
      if (rgbTif) fd.append('rgb_tif', rgbTif)
      if (rgbTfw) fd.append('rgb_tfw', rgbTfw)
      Object.entries(panelData).forEach(([k, v]) => { if (v) fd.append(k, v) })
      const res = await apiFetch('/missions/upload', { method: 'POST', body: fd })
      if (res.status === 403) {
        setShowBlocked(true)
        setUploading(false)
        return
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setUploadError(d.detail || 'Errore upload')
        setUploading(false)
        return
      }
      const job = await res.json()
      setActiveJob(job)
      startPolling(job.id)
      setThermalTif(null); setThermalTfw(null); setRgbTif(null); setRgbTfw(null)
      setUploading(false)
    } catch (err: unknown) {
      setUploadError(String(err))
      setUploading(false)
    }
  }

  // ── Payments ───────────────────────────────────────────────────────────
  const [subscribeLoading, setSubscribeLoading] = useState<Record<string, boolean>>({})
  const [subscribeError, setSubscribeError] = useState('')
  const [packQty, setPackQty] = useState(1)
  const [buyCreditsLoading, setBuyCreditsLoading] = useState(false)
  const [buyCreditsError, setBuyCreditsError] = useState('')

  async function buyCredits() {
    setBuyCreditsLoading(true)
    setBuyCreditsError('')
    try {
      const res = await apiFetch('/payments/buy-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: packQty }),
      })
      const d = await res.json()
      if (d.checkout_url) {
        window.location.href = d.checkout_url
      } else {
        setBuyCreditsError(d.detail || 'Errore durante il pagamento. Riprova.')
      }
    } catch {
      setBuyCreditsError('Errore di rete. Controlla la connessione e riprova.')
    }
    setBuyCreditsLoading(false)
  }

  async function subscribePlan(planKey: string) {
    setSubscribeLoading((prev) => ({ ...prev, [planKey]: true }))
    setSubscribeError('')
    try {
      const res = await apiFetch('/payments/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: planKey }),
      })
      const d = await res.json()
      if (d.checkout_url) {
        window.location.href = d.checkout_url
      } else {
        setSubscribeError(d.detail || 'Errore durante l\'attivazione. Riprova.')
      }
    } catch {
      setSubscribeError('Errore di rete. Controlla la connessione e riprova.')
    }
    setSubscribeLoading((prev) => ({ ...prev, [planKey]: false }))
  }

  // ── Ticket conversation ────────────────────────────────────────────────
  async function openTicketModal(ticketId: number, notifId?: number) {
    if (notifId) {
      apiFetch(`/auth/notifications/${notifId}/read`, { method: 'POST' }).catch(() => {})
      setNotifications((prev) => prev.map((x) => x.id === notifId ? { ...x, is_read: true } : x))
    }
    try {
      const res = await apiFetch(`/auth/tickets/${ticketId}`)
      if (res.ok) {
        const d = await res.json()
        setTicketDetail(d)
        setShowTicketModal(true)
        setShowBellDropdown(false)
        setTicketActionMsg('')
        setTicketReplyText('')
      }
    } catch { /* noop */ }
  }

  async function sendTicketReply() {
    if (!ticketDetail || !ticketReplyText.trim()) return
    setTicketReplyLoading(true)
    try {
      const res = await apiFetch(`/auth/tickets/${ticketDetail.id}/message`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: ticketReplyText.trim() }),
      })
      if (res.ok) {
        const newMsg = { id: Date.now(), sender: 'client', text: ticketReplyText.trim(), created_at: new Date().toISOString() }
        setTicketDetail((prev) => prev ? { ...prev, status: 'aperto', messages: [...prev.messages, newMsg] } : prev)
        setTicketReplyText('')
        setTicketActionMsg('Messaggio inviato')
        setTimeout(() => setTicketActionMsg(''), 3000)
      }
    } catch { /* noop */ }
    setTicketReplyLoading(false)
  }

  async function handleCloseTicket() {
    if (!ticketDetail) return
    try {
      const res = await apiFetch(`/auth/tickets/${ticketDetail.id}/close`, { method: 'POST' })
      if (res.ok) {
        setClientClosedTicketIds((prev) => new Set([...prev, ticketDetail.id]))
        setTicketDetail((prev) => prev ? { ...prev, status: 'risolto' } : prev)
        setTicketRefreshKey((k) => k + 1)
      }
    } catch { /* noop */ }
  }

  // ── Reviews ────────────────────────────────────────────────────────────
  async function submitReview(e: React.FormEvent) {
    e.preventDefault()
    if (!starValue) { setReviewMsg('Seleziona una valutazione'); return }
    try {
      const res = await apiFetch('/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stars: starValue, comment: reviewComment }),
      })
      if (res.ok) {
        const created = await res.json().catch(() => ({ id: '', stars: starValue, comment: reviewComment }))
        setMyReview(created)
        setStarValue(0); setReviewComment('')
        setReviewMsg('Recensione inviata! Sarà pubblicata dopo approvazione.')
      } else setReviewMsg('Errore invio')
    } catch { setReviewMsg('Errore') }
  }

  // ── FlightHub 2 ────────────────────────────────────────────────────────
  async function fhConnect() {
    if (!fhForm.workspace_id || !fhForm.client_id || !fhForm.client_secret) {
      setFhMsg('Compila tutti i campi'); return
    }
    try {
      const res = await apiFetch('/flighthub/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fhForm),
      })
      const d = await res.json()
      if (res.ok) {
        setFhMsg('')
        setShowFhModal(false)
        setFhForm({ workspace_id: '', client_id: '', client_secret: '' })
        const s = await apiFetch('/flighthub/status').then(r => r.json())
        setFhStatus(s)
      } else {
        setFhMsg(d.detail || 'Connessione fallita')
      }
    } catch { setFhMsg('Errore di rete') }
  }

  async function fhDisconnect() {
    await apiFetch('/flighthub/disconnect', { method: 'DELETE' })
    setFhStatus({ connected: false, missions: [] })
  }

  async function fhSync() {
    setFhSyncing(true)
    try {
      const res = await apiFetch('/flighthub/sync', { method: 'POST' })
      const d = await res.json()
      if (res.ok) {
        const s = await apiFetch('/flighthub/status').then(r => r.json())
        setFhStatus(s)
        setFhMsg(d.message || 'Sync completato')
        setTimeout(() => setFhMsg(''), 4000)
      } else {
        setFhMsg(d.detail || 'Errore sync')
      }
    } catch { setFhMsg('Errore di rete') }
    setFhSyncing(false)
  }

  async function fhDownload(fhJobId: number, format: string) {
    try {
      const res = await apiFetch(`/flighthub/missions/${fhJobId}/download/${format}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `flighthub_${fhJobId}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { }
  }

  // ── Delete account (E) ─────────────────────────────────────────────────
  async function deleteAccountFromMain() {
    try {
      await apiFetch('/auth/me', { method: 'DELETE' })
      localStorage.clear()
      window.location.href = '/login'
    } catch { /* noop */ }
  }

  // ── Download ───────────────────────────────────────────────────────────
  async function downloadFile(jobId: string, format: string) {
    try {
      const res = await apiFetch(`/missions/${jobId}/download/${format}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `mission_${jobId}.${format}`
      a.click()
      URL.revokeObjectURL(url)
    } catch { }
  }


  const initials = userName ? userName.split(' ').map((w: string) => w[0]).join('').toUpperCase().slice(0, 2) : '??'

  const cardAnim = { hidden: { opacity: 0, y: 20 }, show: { opacity: 1, y: 0, transition: { duration: 0.5 } } }
  const containerAnim = { hidden: {}, show: { transition: { staggerChildren: 0.08 } } }

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg)', position: 'relative' }}>
      <div className="grid-overlay" />

      {/* ── Navbar ──────────────────────────────────────────────────── */}
      <nav className="navbar-glass sticky top-0 z-30">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="flex items-center justify-center rounded-xl"
              style={{ width: 36, height: 36, background: 'linear-gradient(135deg,#f59e0b,#f97316)', boxShadow: '0 0 16px rgba(245,158,11,0.35)', flexShrink: 0 }}
            >
              <Sun size={18} color="#000" strokeWidth={2.5} />
            </div>
            <span style={{ fontWeight: 700, fontSize: '1.05rem', color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>SolarDino</span>
          </div>

          <div className="flex items-center gap-2">
            <div className="badge badge-amber" style={{ cursor: 'default' }}>
              {credits} elaborazioni rimaste
            </div>
            {subscriptionActive && subscriptionEndDate && (
              <div style={{
                display: 'inline-flex', alignItems: 'center',
                padding: '0.2rem 0.65rem', borderRadius: 9999,
                background: 'rgba(239,68,68,0.15)',
                border: '1px solid rgba(239,68,68,0.35)',
                color: '#ef4444', fontSize: '0.72rem', fontWeight: 700,
                cursor: 'default', whiteSpace: 'nowrap',
              }}>
                scade {new Date(subscriptionEndDate).toLocaleDateString('it-IT', { day: '2-digit', month: 'short' })}
              </div>
            )}

            {/* Bell icon (C) */}
            <div ref={bellRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setShowBellDropdown((v) => !v)}
                className="btn-ghost flex items-center justify-center"
                style={{ width: 36, height: 36, padding: 0, position: 'relative' }}
                title="Notifiche"
              >
                <Bell size={17} />
                {notifications.filter((n) => !n.is_read).length > 0 && (
                  <span style={{
                    position: 'absolute', top: 4, right: 4,
                    width: 16, height: 16, borderRadius: '50%',
                    background: '#ef4444', color: '#fff',
                    fontSize: '0.6rem', fontWeight: 700,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    border: '2px solid var(--navbar-bg)',
                  }}>
                    {notifications.filter((n) => !n.is_read).length}
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
                      background: isDark ? '#0d1117' : '#fff',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 14, minWidth: 300, maxWidth: 360,
                      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                      overflow: 'hidden',
                    }}
                  >
                    <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                        Notifiche
                      </span>
                    </div>
                    {notifications.length === 0 ? (
                      <div style={{ padding: '1rem', fontSize: '0.82rem', color: 'var(--text-muted)', textAlign: 'center' }}>
                        Nessuna notifica
                      </div>
                    ) : (
                      <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                        {notifications.map((n) => (
                          <div
                            key={n.id}
                            style={{ padding: '0.7rem 1rem', borderBottom: '1px solid rgba(255,255,255,0.04)', background: n.is_read ? 'transparent' : 'rgba(245,158,11,0.05)', cursor: 'pointer' }}
                            onClick={() => {
                              if (n.ticket_id) {
                                openTicketModal(n.ticket_id, n.id)
                              } else if (!n.is_read) {
                                apiFetch(`/auth/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {})
                                setNotifications((prev) => prev.map((x) => x.id === n.id ? { ...x, is_read: true } : x))
                              }
                            }}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--text-primary)' }}>{n.title}</span>
                              {!n.is_read && <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b', flexShrink: 0 }} />}
                            </div>
                            <div style={{ fontSize: '0.73rem', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 2 }}>{n.message}</div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>
                              {new Date(n.created_at).toLocaleDateString('it-IT')}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>


            <button
              onClick={() => setShowProfile(true)}
              className="flex items-center justify-center rounded-full btn-ghost"
              style={{ width: 36, height: 36, padding: 0, background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#000', fontWeight: 700, fontSize: '0.75rem' }}
            >
              {initials}
            </button>
          </div>
        </div>
      </nav>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <motion.div
        className="max-w-6xl mx-auto px-4 py-8"
        variants={containerAnim}
        initial="hidden"
        animate="show"
        style={{ position: 'relative', zIndex: 1 }}
      >
        {/* No credits alert */}
        {credits <= 0 && (
          <motion.div
            variants={cardAnim}
            className="flex items-center gap-3 rounded-2xl p-4 mb-6"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444' }}
          >
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: '0.875rem' }}>
              <strong>Crediti esauriti.</strong>{' '}
              Acquista un pacchetto per continuare le elaborazioni.
            </span>
          </motion.div>
        )}


        {/* Welcome */}
        <motion.div variants={cardAnim} className="mb-8">
          <h1 style={{ fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', fontWeight: 800, letterSpacing: '-0.03em', color: 'var(--text-primary)', marginBottom: 6 }}>
            Benvenuto,{' '}
            <span className="text-amber-gradient">{userName || 'utente'}</span>
          </h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.925rem' }}>
            Carica due ortomosaici per avviare l'analisi AI.
          </p>
        </motion.div>

        {/* Metodo selector */}
        <motion.div variants={cardAnim} className="card mb-6">
          <div className="flex items-center gap-2 mb-4">
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Modalità elaborazione
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button
              onClick={() => setStrada(strada === 'A' ? null : 'A')}
              className="rounded-xl p-4 text-left transition-all"
              style={{
                background: strada === 'A' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)',
                border: strada === 'A' ? '1.5px solid rgba(245,158,11,0.5)' : '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
              }}
            >
              <div className="flex items-center gap-3 mb-2">
                <div style={{ width: 32, height: 32, background: strada === 'A' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: strada === 'A' ? '#f59e0b' : 'var(--text-muted)' }}>
                  <Upload size={15} />
                </div>
                <div>
                  <div style={{ color: strada === 'A' ? '#f59e0b' : 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem' }}>Metodo Standard</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Software di Fotogrammetria · upload manuale</div>
                </div>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0, lineHeight: 1.6 }}>
                Carica manualmente il file TIF termico elaborato con software desktop (Pix4D, DJI Terra, ecc.).
              </p>
            </button>

            <button
              onClick={() => setStrada(strada === 'B' ? null : 'B')}
              className="rounded-xl p-4 text-left transition-all"
              style={{
                background: strada === 'B' ? 'rgba(245,158,11,0.1)' : 'rgba(255,255,255,0.03)',
                border: strada === 'B' ? '1.5px solid rgba(245,158,11,0.5)' : '1px solid rgba(255,255,255,0.08)',
                cursor: 'pointer',
              }}
            >
              <div className="flex items-center gap-3 mb-2">
                <div style={{ width: 32, height: 32, background: strada === 'B' ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.05)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: strada === 'B' ? '#f59e0b' : 'var(--text-muted)' }}>
                  <Radio size={15} />
                </div>
                <div>
                  <div style={{ color: strada === 'B' ? '#f59e0b' : 'var(--text-primary)', fontWeight: 700, fontSize: '0.9rem' }}>Metodo Enterprise</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>DJI FlightHub 2 · automatico</div>
                </div>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', margin: 0, lineHeight: 1.6 }}>
                Collega DJI FlightHub 2: il drone vola, l'AI analizza e i risultati vengono caricati automaticamente.
              </p>
            </button>
          </div>
        </motion.div>

        {/* Strada A: Upload manuale */}
        {strada === 'A' && (
        <motion.div variants={cardAnim} className="card mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
              <Upload size={17} />
            </div>
            <div>
              <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Nuova Elaborazione</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>Carica i file ortomosaico per avviare l'analisi</p>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <DropZone label="Termico TIF *" accept=".tif,.tiff" file={thermalTif} onFile={setThermalTif} />
            <DropZone label="Termico TFW" accept=".tfw" file={thermalTfw} onFile={setThermalTfw} />
            <DropZone label="RGB TIF" accept=".tif,.tiff" file={rgbTif} onFile={setRgbTif} />
            <DropZone label="RGB TFW" accept=".tfw" file={rgbTfw} onFile={setRgbTfw} />
          </div>

          {/* Panel data — always visible */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem', marginBottom: '1rem' }}>
            <div className="flex items-center gap-2 mb-3">
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Dati pannelli
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '1px 6px' }}>
                opzionale
              </span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { k: 'marca', label: 'Marca' },
                { k: 'modello', label: 'Modello' },
                { k: 'dimensioni', label: 'Dimensioni (m)' },
                { k: 'efficienza', label: 'Efficienza nominale (%)' },
                { k: 'coefficiente', label: 'Coeff. temperatura (%/°C)' },
              ].map(({ k, label }) => (
                <div key={k}>
                  <label className="form-label">{label}</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder={label}
                    value={panelData[k as keyof typeof panelData]}
                    onChange={(e) => setPanelData((p) => ({ ...p, [k]: e.target.value }))}
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>
              ))}
            </div>
          </div>

          {uploadError && (
            <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: '0.85rem' }}>
              {uploadError}
            </div>
          )}

          <button
            className="btn-amber"
            disabled={!thermalTif || uploading || credits <= 0}
            onClick={() => setShowConsent(true)}
            style={{ fontSize: '0.925rem' }}
          >
            {uploading ? 'Caricamento...' : 'Avvia Elaborazione AI'}
          </button>
          {credits <= 0 && (
            <span style={{ fontSize: '0.8rem', color: '#ef4444', marginLeft: 12 }}>Crediti insufficienti</span>
          )}
        </motion.div>
        )}

        {/* Strada B: FlightHub 2 */}
        {strada === 'B' && (
        <motion.div variants={cardAnim} className="card mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
              <Radio size={17} />
            </div>
            <div>
              <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0 }}>
                FlightHub 2 — Enterprise
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>
                Integrazione automatica con DJI FlightHub 2
              </p>
            </div>
            <div className="ml-auto">
              {fhStatus.connected
                ? <span className="badge badge-green"><Wifi size={11} /> Connesso</span>
                : <span className="badge badge-red"><WifiOff size={11} /> Non connesso</span>
              }
            </div>
          </div>

          {fhMsg && (
            <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', fontSize: '0.82rem' }}>
              {fhMsg}
            </div>
          )}

          {!fhStatus.connected ? (
            <div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.7, marginBottom: '1rem' }}>
                Collega il tuo account DJI FlightHub 2 per ricevere e analizzare automaticamente le mappe ortomosaico.
                Ogni volta che un volo completa l'elaborazione, SolarDino AI scarica l'immagine, identifica i pannelli
                guasti e carica i risultati direttamente in FlightHub 2 — senza che tu debba fare nulla.
              </p>
              <button className="btn-amber" style={{ fontSize: '0.9rem' }} onClick={() => setShowFhModal(true)}>
                <Wifi size={15} /> Connetti FlightHub 2
              </button>
            </div>
          ) : (
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-5">
                <div className="rounded-xl px-4 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                  <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Workspace</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600 }}>{fhStatus.workspace_id}</div>
                </div>
                {fhStatus.last_sync_at && (
                  <div className="rounded-xl px-4 py-2" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
                    <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Ultimo sync</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {new Date(fhStatus.last_sync_at).toLocaleString('it-IT')}
                    </div>
                  </div>
                )}
                <div className="flex gap-2 ml-auto">
                  <button
                    className="btn-amber flex items-center gap-2"
                    style={{ fontSize: '0.82rem', padding: '0.5rem 1rem' }}
                    disabled={fhSyncing}
                    onClick={fhSync}
                  >
                    <RefreshCw size={13} style={{ animation: fhSyncing ? 'spin-slow 1s linear infinite' : 'none' }} />
                    {fhSyncing ? 'Sincronizzazione…' : 'Sincronizza ora'}
                  </button>
                  <button
                    className="btn-ghost flex items-center gap-2"
                    style={{ fontSize: '0.82rem', padding: '0.5rem 1rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }}
                    onClick={fhDisconnect}
                  >
                    <WifiOff size={13} /> Disconnetti
                  </button>
                </div>
              </div>

              {/* Missions list */}
              {fhStatus.missions.length === 0 ? (
                <div className="rounded-xl p-4 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: 0 }}>
                    Nessuna missione ancora elaborata. Clicca "Sincronizza ora" o configura il webhook DJI.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {fhStatus.missions.map((m) => (
                    <div key={m.id} className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: '0.875rem', marginBottom: 4 }}>
                            {m.fh_map_name || m.fh_map_id}
                          </div>
                          <div className="flex items-center gap-3 flex-wrap">
                            <span className={`badge ${m.status === 'done' ? 'badge-green' : m.status === 'error' ? 'badge-red' : 'badge-amber'}`} style={{ fontSize: '0.65rem' }}>
                              {m.status === 'done' ? 'Completato' : m.status === 'error' ? 'Errore' : m.status === 'downloading' ? 'Download…' : m.status === 'processing' ? 'Elaborazione…' : m.status === 'uploading' ? 'Upload risultati…' : 'In attesa'}
                            </span>
                            {m.status === 'done' && m.panels_detected != null && (
                              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                {m.panels_detected} pannelli · {m.hotspot_count ?? 0} hotspot
                              </span>
                            )}
                            {m.results_uploaded && (
                              <span className="badge badge-green" style={{ fontSize: '0.65rem' }}>
                                <Check size={10} /> Risultati su FlightHub
                              </span>
                            )}
                            <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                              {new Date(m.created_at).toLocaleDateString('it-IT')}
                            </span>
                          </div>
                          {m.error_msg && (
                            <div style={{ fontSize: '0.75rem', color: '#ef4444', marginTop: 4 }}>{m.error_msg}</div>
                          )}
                        </div>
                        {m.status === 'done' && (
                          <div className="flex gap-1">
                            {['kml', 'json', 'csv'].map((fmt) => (
                              <button
                                key={fmt}
                                onClick={() => fhDownload(m.id, fmt)}
                                className="btn-ghost flex items-center gap-1"
                                style={{ padding: '0.25rem 0.5rem', fontSize: '0.7rem', textTransform: 'uppercase' }}
                              >
                                <FileDown size={11} /> {fmt}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </motion.div>
        )}

        {/* Strada B: Avvia Inferenza + consenso dati */}
        {strada === 'B' && (
        <motion.div variants={cardAnim} className="card mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
              <Zap size={17} />
            </div>
            <div>
              <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Avvia Elaborazione</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>Analisi AI automatica tramite FlightHub 2</p>
            </div>
          </div>

          {/* Dati pannelli opzionali */}
          <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '1rem', marginBottom: '1.25rem' }}>
            <div className="flex items-center gap-2 mb-1">
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Dati pannelli
              </span>
              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '1px 6px' }}>
                opzionale
              </span>
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: '0.875rem' }}>
              Inserendo marca, modello, efficienza nominale e coefficiente di temperatura, il report includerà il
              <strong style={{ color: 'var(--text-secondary)' }}> calcolo della perdita di potenza stimata</strong> per
              ogni pannello anomalo e la <strong style={{ color: 'var(--text-secondary)' }}>stima dell'impatto economico annuo</strong>.
              Senza questi dati l'analisi rileva comunque tutti gli hotspot e i pannelli guasti.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { k: 'marca', label: 'Marca' },
                { k: 'modello', label: 'Modello' },
                { k: 'dimensioni', label: 'Dimensioni (m)' },
                { k: 'efficienza', label: 'Efficienza nominale (%)' },
                { k: 'coefficiente', label: 'Coeff. temperatura (%/°C)' },
              ].map(({ k, label }) => (
                <div key={k}>
                  <label className="form-label">{label}</label>
                  <input
                    className="form-input"
                    type="text"
                    placeholder={label}
                    value={panelData[k as keyof typeof panelData]}
                    onChange={(e) => setPanelData((p) => ({ ...p, [k]: e.target.value }))}
                    style={{ fontSize: '0.85rem' }}
                  />
                </div>
              ))}
            </div>
          </div>

          <button
            className={fhStatus.connected && credits > 0 ? 'btn-amber' : 'btn-ghost'}
            style={{ fontSize: '0.925rem', opacity: fhStatus.connected && credits > 0 ? 1 : 0.45, cursor: fhStatus.connected && credits > 0 ? 'pointer' : 'not-allowed' }}
            disabled={!fhStatus.connected || credits <= 0}
            onClick={() => setShowEnterpriseConsent(true)}
          >
            <Zap size={16} /> Avvia Elaborazione
          </button>
          {!fhStatus.connected && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginLeft: 12 }}>Connetti FlightHub 2 per abilitare</span>
          )}
          {fhStatus.connected && credits <= 0 && (
            <span style={{ fontSize: '0.8rem', color: '#ef4444', marginLeft: 12 }}>Crediti insufficienti</span>
          )}
        </motion.div>
        )}

        {/* Active job — floating popup (rendered outside flow at bottom of return) */}

        {/* Credits / Payments — nascosto se abbonamento attivo */}
        {!subscriptionActive && <motion.div variants={cardAnim} className="card mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
              <CreditCard size={17} />
            </div>
            <div>
              <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Acquista Elaborazioni</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', margin: 0 }}>Scegli il pacchetto più adatto alle tue esigenze</p>
            </div>
          </div>

          {/* Abbonamenti Mensili */}
          {subscribeError && (
            <div className="rounded-xl p-3 mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', fontSize: '0.85rem' }}>
              {subscribeError}
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {([
              { key: 'starter',   label: 'Starter',   credits: 10,   price: 149.99, originalPrice: null,   popular: false, color: 'rgba(255,255,255,0.07)', btnStyle: { background: 'rgba(255,255,255,0.08)', color: 'var(--text-primary)' }, period: '/mese' },
              { key: 'medium',    label: 'Medium',    credits: 20,   price: 249.99, originalPrice: 299.00, popular: true,  color: 'rgba(245,158,11,0.35)',  btnStyle: { background: 'linear-gradient(90deg,#f59e0b,#f97316)', color: '#000' }, period: '/mese' },
              { key: 'unlimited', label: 'Unlimited', credits: null, price: 449.99, originalPrice: 600.00, popular: false, color: 'rgba(34,197,94,0.35)',   btnStyle: { background: '#22c55e', color: '#000' }, period: '/mese' },
            ] as { key: string; label: string; credits: number | null; price: number; originalPrice: number | null; popular: boolean; color: string; btnStyle: React.CSSProperties; period: string }[]).map((plan) => {
              const discount = plan.originalPrice ? Math.round((1 - plan.price / plan.originalPrice) * 100) : 0
              const savings  = plan.originalPrice ? (plan.originalPrice - plan.price).toFixed(2) : null
              const perElab  = plan.credits != null ? (plan.price / plan.credits).toFixed(2) : null
              const isLoading = !!subscribeLoading[plan.key]
              return (
                <div
                  key={plan.key}
                  className="rounded-xl flex flex-col"
                  style={{ border: `1px solid ${plan.color}`, background: 'rgba(255,255,255,0.02)', position: 'relative', overflow: 'hidden' }}
                >
                  <div style={{ background: plan.popular ? 'linear-gradient(90deg,#f59e0b,#f97316)' : 'transparent', textAlign: 'center', padding: '4px 0', fontSize: '0.7rem', fontWeight: 700, color: '#000', letterSpacing: '0.05em', visibility: plan.popular ? 'visible' : 'hidden' }}>
                    PIÙ POPOLARE
                  </div>
                  <div style={{ padding: '1rem', flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* label + discount */}
                    <div className="flex items-center justify-between">
                      <span style={{ fontSize: '0.72rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{plan.label}</span>
                      {discount > 0 && (
                        <span style={{ fontSize: '0.68rem', fontWeight: 700, color: '#22c55e', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 20, padding: '1px 8px' }}>-{discount}%</span>
                      )}
                    </div>
                    {/* elaborazioni */}
                    <div style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '2rem', lineHeight: 1 }}>
                      {plan.credits != null ? plan.credits : '∞'}
                      <span style={{ fontSize: '0.82rem', fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>elaborazioni{plan.period}</span>
                    </div>
                    {/* prezzo per elaborazione */}
                    <div className="flex items-center justify-between" style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', visibility: perElab ? 'visible' : 'hidden' }}>
                      <span>Prezzo per elaborazione</span>
                      <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>€{perElab}</span>
                    </div>
                    {/* banner risparmio */}
                    <div style={{ background: 'rgba(245,158,11,0.1)', border: `1px solid ${savings ? 'rgba(245,158,11,0.2)' : 'transparent'}`, borderRadius: 8, padding: '5px 10px', fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600, visibility: savings ? 'visible' : 'hidden' }}>
                      🔥 Risparmi €{savings} rispetto al prezzo pieno
                    </div>
                    {/* prezzo */}
                    <div className="flex items-baseline gap-2" style={{ marginTop: 'auto', paddingTop: 6 }}>
                      {plan.originalPrice && (
                        <span style={{ fontSize: '0.88rem', color: 'var(--text-muted)', textDecoration: 'line-through' }}>€{plan.originalPrice}{plan.period}</span>
                      )}
                      <span style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1.4rem' }}>
                        €{plan.price.toFixed(2)}<span style={{ fontSize: '0.78rem', fontWeight: 400, color: 'var(--text-muted)' }}>{plan.period}</span>
                      </span>
                    </div>
                    {/* bottone */}
                    <button
                      className="w-full"
                      style={{ ...plan.btnStyle, border: 'none', borderRadius: 10, padding: '0.65rem', fontSize: '0.85rem', fontWeight: 700, cursor: isLoading ? 'not-allowed' : 'pointer', marginTop: 4, opacity: isLoading ? 0.7 : 1 }}
                      disabled={isLoading}
                      onClick={() => subscribePlan(plan.key)}
                    >
                      {isLoading ? 'Reindirizzamento...' : 'Attiva abbonamento'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.div>}

        {/* ── Crediti extra (pack una-tantum) ──────────────────────────────
            Mostrato quando:
            • abbonamento attivo ma crediti esauriti (sezione principale)
            • oppure sotto ai piani mensili quando non c'è abbonamento
        ─────────────────────────────────────────────────────────────── */}
        {subscriptionActive && credits <= 0 ? (() => {
          const activePlan = subscriptionActive ? subscriptionPlan : null
          const { price: unitPrice, isFlat } = getCreditUnitPrice(packQty, activePlan)
          const total = (unitPrice * packQty)
          const nextTier = isFlat ? null : CREDIT_TIERS.slice().reverse().find(t => t.min > packQty)

          return (
            <motion.div variants={cardAnim} className="card mb-6">
              <div className="flex items-center gap-3 mb-1">
                <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
                  <Zap size={17} />
                </div>
                <div>
                  <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0 }}>
                    {subscriptionActive ? 'Crediti esauriti — Acquista elaborazioni extra' : 'Acquista elaborazioni una-tantum'}
                  </h2>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', margin: 0 }}>
                    Scadono al prossimo rinnovo abbonamento
                  </p>
                </div>
              </div>

              {subscriptionActive && credits <= 0 && (
                <div className="rounded-xl p-3 mb-4 mt-3" style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: '0.82rem' }}>
                  <strong>I crediti del tuo abbonamento sono esauriti.</strong> Acquista elaborazioni extra — scadono al prossimo rinnovo.
                </div>
              )}

              {/* ── Calcolatore quantità ── */}
              <div className="flex flex-col lg:flex-row gap-6 mt-4">

                {/* Colonna sinistra: selettore + prezzo */}
                <div className="flex flex-col gap-4" style={{ flex: 1 }}>
                  {/* Selettore +/- */}
                  <div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600, marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.07em', textAlign: 'center' }}>
                      Numero di elaborazioni
                    </div>
                    <div className="flex flex-col items-center gap-3">
                      <div className="flex items-center justify-center gap-3">
                        <button
                          onClick={() => setPackQty(q => Math.max(1, q - 1))}
                          style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: '1.3rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                        >−</button>
                        <input
                          type="number"
                          min={1} max={500}
                          value={packQty}
                          onChange={e => setPackQty(Math.max(1, Math.min(500, parseInt(e.target.value) || 1)))}
                          style={{ width: 80, textAlign: 'center', fontSize: '1.4rem', fontWeight: 800, color: 'var(--text-primary)', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(245,158,11,0.3)', borderRadius: 10, padding: '0.45rem 0', outline: 'none' }}
                        />
                        <button
                          onClick={() => setPackQty(q => Math.min(500, q + 1))}
                          style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', color: 'var(--text-primary)', fontSize: '1.3rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
                        >+</button>
                      </div>
                      {/* Quick-picks */}
                      <div className="flex gap-1.5 flex-wrap justify-center">
                        {[5, 10, 20, 50].map(n => (
                          <button
                            key={n}
                            onClick={() => setPackQty(n)}
                            style={{ padding: '0.3rem 0.7rem', borderRadius: 8, fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', background: packQty === n ? 'rgba(245,158,11,0.15)' : 'rgba(255,255,255,0.04)', border: `1px solid ${packQty === n ? 'rgba(245,158,11,0.4)' : 'rgba(255,255,255,0.1)'}`, color: packQty === n ? '#f59e0b' : 'var(--text-muted)' }}
                          >{n}</button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Prezzo dinamico */}
                  <div className="rounded-xl p-4" style={{ background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)', textAlign: 'center' }}>
                    <div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: 2 }}>
                        €{unitPrice.toFixed(2)}/elab × {packQty}
                      </div>
                      <div style={{ fontSize: '2rem', fontWeight: 900, color: 'var(--text-primary)', lineHeight: 1 }}>
                        €{total.toFixed(2)}
                      </div>
                    </div>

                    {/* hint prossimo scaglione */}
                    {nextTier && (
                      <div style={{ fontSize: '0.72rem', color: '#f59e0b', marginTop: 8 }}>
                        💡 Aggiungi {nextTier.min - packQty} elaborazion{nextTier.min - packQty === 1 ? 'e' : 'i'} per arrivare a {nextTier.min} e pagare €{nextTier.price.toFixed(2)}/cad (-{nextTier.discount}%)
                      </div>
                    )}
                  </div>

                  {buyCreditsError && (
                    <div className="rounded-xl p-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', fontSize: '0.82rem' }}>
                      {buyCreditsError}
                    </div>
                  )}

                  <button
                    onClick={buyCredits}
                    disabled={buyCreditsLoading}
                    className="btn-amber w-full"
                    style={{ padding: '0.85rem', fontSize: '0.95rem', opacity: buyCreditsLoading ? 0.7 : 1 }}
                  >
                    {buyCreditsLoading
                      ? 'Reindirizzamento...'
                      : `Acquista ${packQty} elaborazion${packQty === 1 ? 'e' : 'i'} — €${total.toFixed(2)}`}
                  </button>
                </div>

              </div>
            </motion.div>
          )
        })() : null}

        {/* Form recensione — sparisce se l'utente ha già recensito */}
        {!myReview && (
          <motion.div variants={cardAnim} className="card mb-6">
            <div className="flex items-center gap-3 mb-5">
              <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
                <Star size={17} />
              </div>
              <h2 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Lascia una recensione</h2>
            </div>
            <form onSubmit={submitReview} className="flex flex-col gap-4">
              <div>
                <label className="form-label">La tua valutazione</label>
                <StarRating value={starValue} onChange={setStarValue} />
              </div>
              <div>
                <label className="form-label">Commento (opzionale)</label>
                <textarea
                  className="form-input"
                  rows={3}
                  placeholder="Scrivi la tua esperienza..."
                  value={reviewComment}
                  onChange={(e) => setReviewComment(e.target.value)}
                  style={{ resize: 'vertical' }}
                />
              </div>
              {reviewMsg && (
                <div className="rounded-xl p-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', fontSize: '0.85rem' }}>
                  {reviewMsg}
                </div>
              )}
              <button type="submit" className="btn-amber" style={{ alignSelf: 'flex-start' }}>
                <Check size={15} /> Invia recensione
              </button>
            </form>
          </motion.div>
        )}


        {/* Richiesta assistenza */}
        <SupportCard onOpenTicket={openTicketModal} refreshKey={ticketRefreshKey} />
      </motion.div>

      {/* ── Modals ───────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showConsent && (
          <ConsentModal
            onClose={() => setShowConsent(false)}
            onConfirm={() => { setShowConsent(false); doUpload() }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showEnterpriseConsent && (
          <EnterpriseConsentModal
            onClose={() => setShowEnterpriseConsent(false)}
            onConfirm={async () => {
              setShowEnterpriseConsent(false)
              try {
                const res = await apiFetch('/flighthub/avvia-inferenza', { method: 'POST' })
                const data = await res.json()
                if (res.ok) {
                  setFhMsg(data.message)
                  if (data.syncing) await fhSync()
                } else {
                  setFhMsg(data.detail || "Errore durante l'avvio")
                }
              } catch {
                setFhMsg('Errore di rete')
              }
            }}
          />
        )}
      </AnimatePresence>

      {/* Blocked account modal */}
      <AnimatePresence>
        {showBlocked && (
          <div className="modal-overlay" onClick={() => setShowBlocked(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="card"
              style={{ maxWidth: 440, width: '100%', padding: '2rem', borderRadius: 20, border: '1px solid rgba(239,68,68,0.3)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center gap-3 mb-4">
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'rgba(239,68,68,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <AlertTriangle size={20} color="#ef4444" />
                </div>
                <h3 style={{ color: '#ef4444', fontWeight: 700, fontSize: '1.05rem' }}>Azienda bloccata</h3>
              </div>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', lineHeight: 1.7, marginBottom: '1.5rem' }}>
                Il tuo account è stato bloccato dall'amministratore. Non è possibile avviare nuove elaborazioni.
                Contatta l'assistenza per risolvere il problema.
              </p>
              <a
                href="mailto:agervasini1@gmail.com"
                className="btn-amber w-full flex items-center justify-center gap-2"
                style={{ textDecoration: 'none', padding: '0.75rem' }}
              >
                <Mail size={15} /> Contatta l'assistenza
              </a>
              <button
                className="btn-ghost w-full mt-2"
                style={{ width: '100%' }}
                onClick={() => setShowBlocked(false)}
              >
                Chiudi
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>


      {/* FlightHub 2 connect modal */}
      <AnimatePresence>
        {showFhModal && (
          <div className="modal-overlay" onClick={() => setShowFhModal(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="card"
              style={{ maxWidth: 480, width: '100%', padding: '2rem', borderRadius: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <Radio size={20} style={{ color: '#f59e0b' }} />
                  <h3 style={{ color: 'var(--text-primary)', fontSize: '1.05rem', fontWeight: 700 }}>
                    Connetti DJI FlightHub 2
                  </h3>
                </div>
                <button onClick={() => setShowFhModal(false)} className="btn-ghost" style={{ padding: '0.3rem' }}>
                  <X size={18} />
                </button>
              </div>

              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: '1.25rem' }}>
                Inserisci le credenziali OAuth2 del tuo progetto DJI Developer. Le trovi nella console
                DJI Developer → Applications → Client credentials.
              </p>

              <div className="flex flex-col gap-3">
                <div>
                  <label className="form-label">Workspace ID</label>
                  <input
                    className="form-input"
                    placeholder="es. ws_abc123..."
                    value={fhForm.workspace_id}
                    onChange={(e) => setFhForm(f => ({ ...f, workspace_id: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Client ID</label>
                  <input
                    className="form-input"
                    placeholder="OAuth2 client_id"
                    value={fhForm.client_id}
                    onChange={(e) => setFhForm(f => ({ ...f, client_id: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="form-label">Client Secret</label>
                  <input
                    className="form-input"
                    type="password"
                    placeholder="OAuth2 client_secret"
                    value={fhForm.client_secret}
                    onChange={(e) => setFhForm(f => ({ ...f, client_secret: e.target.value }))}
                  />
                </div>
              </div>

              {fhMsg && (
                <div className="rounded-xl p-3 mt-3" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', fontSize: '0.8rem' }}>
                  {fhMsg}
                </div>
              )}

              <div className="flex gap-3 mt-5">
                <button className="btn-ghost flex-1" onClick={() => setShowFhModal(false)}>Annulla</button>
                <button className="btn-amber flex-1" onClick={fhConnect}>
                  <Wifi size={14} /> Connetti
                </button>
              </div>

              <div className="mt-4 rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--text-secondary)' }}>Webhook URL:</strong>{' '}
                  <code style={{ color: '#f59e0b', fontSize: '0.72rem' }}>{window.location.origin}/api/flighthub/webhook</code>
                  <br />Configura questo URL nel portale DJI Developer per ricevere notifiche automatiche.
                </p>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showProfile && (
          <ProfileSidebar
            name={userName}
            email={userEmail}
            ragioneSociale={ragioneSociale}
            history={history}
            downloadFile={downloadFile}
            myReview={myReview}
            onReviewUpdate={(r) => setMyReview(r)}
            onClose={() => setShowProfile(false)}
            isDark={isDark}
            onToggleTheme={toggleTheme}
            subscriptionActive={subscriptionActive}
            subscriptionPlan={subscriptionPlan}
            subscriptionEndDate={subscriptionEndDate}
            subscriptionCancelled={subscriptionCancelled}
            onRequestDelete={() => setShowDeleteModal(true)}
            onChangePassword={() => { setShowProfile(false); setShowChangePwdModal(true) }}
            onChangeEmail={() => { setShowProfile(false); setShowChangeEmailModal(true) }}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showChangePwdModal && <ChangePasswordModal onClose={() => setShowChangePwdModal(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showChangeEmailModal && <ChangeEmailModal onClose={() => setShowChangeEmailModal(false)} />}
      </AnimatePresence>

      <AnimatePresence>
        {showIpModal && <IpWarningModal onClose={() => setShowIpModal(false)} />}
      </AnimatePresence>

      {/* ── Floating elaboration popup ────────────────────────────────── */}
      <AnimatePresence>
        {(uploading || activeJob) && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ type: 'spring', damping: 24, stiffness: 260 }}
            style={{
              position: 'fixed',
              bottom: 24,
              right: 24,
              width: 340,
              zIndex: 60,
              background: '#0d1117',
              border: '1px solid rgba(245,158,11,0.3)',
              borderRadius: 20,
              padding: '1.25rem 1.5rem',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6), 0 0 0 1px rgba(245,158,11,0.1)',
            }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              {activeJob?.status === 'errore' ? (
                <AlertTriangle size={20} color="#ef4444" style={{ flexShrink: 0 }} />
              ) : (
                <motion.div
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
                  style={{ width: 20, height: 20, border: '2px solid rgba(245,158,11,0.25)', borderTopColor: '#f59e0b', borderRadius: '50%', flexShrink: 0 }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ color: activeJob?.status === 'errore' ? '#ef4444' : '#f1f5f9', fontWeight: 700, fontSize: '0.9rem' }}>
                  {activeJob?.status === 'errore' ? 'Elaborazione fallita' : uploading && !activeJob ? 'Caricamento file…' : 'Elaborazione in corso'}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>Analisi AI pannelli solari</div>
              </div>
              {activeJob?.status === 'errore' ? (
                <button
                  onClick={() => setActiveJob(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0, display: 'flex' }}
                >
                  <X size={16} />
                </button>
              ) : activeJob && (
                <span className="badge badge-amber" style={{ fontSize: '0.7rem' }}>
                  {statusEta(activeJob.status)}
                </span>
              )}
            </div>

            {/* Steps */}
            <div className="flex flex-col gap-2 mb-4">
              {([
                { key: 'upload',      label: 'Caricamento file',  pct: 0   },
                { key: 'in_coda',     label: 'In coda',           pct: 5   },
                { key: 'taglio_tile', label: 'Taglio tiles',       pct: 30  },
                { key: 'inferenza',   label: 'Inferenza AI',       pct: 65  },
                { key: 'completato',  label: 'Completato',         pct: 100 },
              ] as { key: string; label: string; pct: number }[]).map((step) => {
                const currentPct = activeJob ? statusProgress(activeJob.status) : -1
                const isUploadStep = step.key === 'upload'
                const done = isUploadStep ? !!activeJob : (activeJob ? currentPct >= step.pct : false)
                const active = isUploadStep ? (uploading && !activeJob) : (activeJob?.status === step.key)
                return (
                  <div key={step.key} className="flex items-center gap-2.5">
                    <div style={{
                      width: 18, height: 18, borderRadius: '50%', flexShrink: 0,
                      border: `2px solid ${done ? '#f59e0b' : active ? 'rgba(245,158,11,0.5)' : 'rgba(255,255,255,0.1)'}`,
                      background: done ? 'rgba(245,158,11,0.15)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      {done && <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#f59e0b' }} />}
                    </div>
                    <span style={{
                      fontSize: '0.8rem',
                      color: active ? '#f59e0b' : done ? '#94a3b8' : '#475569',
                      fontWeight: active ? 600 : 400,
                    }}>
                      {step.label}
                    </span>
                    {active && (
                      <motion.span
                        animate={{ opacity: [1, 0.3, 1] }}
                        transition={{ duration: 1.2, repeat: Infinity }}
                        style={{ fontSize: '0.7rem', color: '#f59e0b', marginLeft: 'auto' }}
                      >
                        in corso…
                      </motion.span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Progress bar */}
            <div style={{ height: 4, background: 'rgba(255,255,255,0.07)', borderRadius: 4, overflow: 'hidden' }}>
              <motion.div
                initial={{ width: '0%' }}
                animate={{ width: activeJob ? `${statusProgress(activeJob.status)}%` : '8%' }}
                transition={{ duration: 0.8, ease: 'easeOut' }}
                style={{ height: '100%', background: 'linear-gradient(90deg,#f59e0b,#f97316)', borderRadius: 4 }}
              />
            </div>
            <div className="flex justify-between mt-1.5">
              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                {activeJob ? `${statusProgress(activeJob.status)}%` : 'Invio…'}
              </span>
              {activeJob && (
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>ID: {activeJob.id.slice(0, 8)}</span>
              )}
            </div>

            {/* Bottone download log errore */}
            {activeJob?.status === 'errore' && (
              <button
                onClick={() => {
                  const lines = [
                    'SolarDino — Log errore elaborazione',
                    '='.repeat(40),
                    `Job ID:    ${activeJob.id}`,
                    `File:      ${activeJob.filename || '—'}`,
                    `Data:      ${activeJob.created_at ? new Date(activeJob.created_at).toLocaleString('it-IT') : '—'}`,
                    `Stato:     errore`,
                    `Dettaglio: ${activeJob.error_message || 'Nessun dettaglio disponibile'}`,
                    '',
                    'Per assistenza contatta agervasini1@gmail.com',
                  ]
                  const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `solardino_errore_${activeJob.id.slice(0, 8)}.txt`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
                className="btn-ghost w-full mt-3"
                style={{ fontSize: '0.8rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}
              >
                <FileDown size={14} /> Scarica log errore
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Delete Account Confirm Modal (E) ────────────────────────────── */}
      <AnimatePresence>
        {showDeleteModal && (
          <div className="modal-overlay" onClick={() => setShowDeleteModal(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="card"
              style={{ maxWidth: 460, width: '100%', padding: '2rem', borderRadius: 20, border: '1px solid rgba(239,68,68,0.3)' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-4">
                <h3 style={{ color: '#ef4444', fontWeight: 700, fontSize: '1.1rem' }}>Elimina account</h3>
                <button onClick={() => setShowDeleteModal(false)} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
              </div>

              {/* Opzione 1 — solo il mio account */}
              <div className="rounded-xl p-4 mb-3" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
                <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.9rem', marginBottom: 6 }}>Elimina il mio account</div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
                  Elimina solo il tuo profilo personale. Gli altri account aziendali rimangono attivi.
                </p>
                <button
                  style={{ width: '100%', padding: '0.55rem', background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)', borderRadius: 10, color: '#ef4444', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
                  onClick={deleteAccountFromMain}
                >
                  Elimina il mio account
                </button>
              </div>

              {/* Opzione 2 — tutto l'account aziendale */}
              <div className="rounded-xl p-4" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
                <div style={{ fontWeight: 700, color: '#f1f5f9', fontSize: '0.9rem', marginBottom: 6 }}>Elimina account aziendale</div>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
                  Elimina <strong>tutti</strong> gli account con la stessa ragione sociale, annulla gli abbonamenti e azzera i crediti.
                  La ragione sociale rimane nel sistema: eventuali nuove registrazioni <strong>non avranno diritto al bonus di benvenuto</strong>.
                </p>
                <button
                  style={{ width: '100%', padding: '0.55rem', background: '#ef4444', border: 'none', borderRadius: 10, color: '#fff', fontWeight: 700, cursor: 'pointer', fontSize: '0.85rem' }}
                  onClick={async () => {
                    try {
                      await apiFetch('/auth/me/company', { method: 'DELETE' })
                      localStorage.clear()
                      window.location.href = '/login'
                    } catch { /* noop */ }
                  }}
                >
                  Elimina tutto l'account aziendale
                </button>
              </div>

              <button className="btn-ghost w-full mt-3" onClick={() => setShowDeleteModal(false)}>Annulla</button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>


      {/* ── Ticket Conversation Modal ─────────────────────────────────── */}
      <AnimatePresence>
        {showTicketModal && ticketDetail && (
          <div className="modal-overlay" style={{ zIndex: 300 }} onClick={() => setShowTicketModal(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="card"
              style={{ maxWidth: 520, width: '100%', padding: '1.5rem', borderRadius: 20, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.68rem', color: '#f59e0b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>
                    Ticket #{ticketDetail.id} · {ticketDetail.status === 'risolto' ? '🔒 Chiuso' : ticketDetail.status === 'in_elaborazione' ? '⚙️ In elaborazione' : '🟢 Aperto'}
                  </div>
                  <h3 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: '1rem', margin: 0, wordBreak: 'break-word' }}>{ticketDetail.subject}</h3>
                </div>
                <button onClick={() => setShowTicketModal(false)} className="btn-ghost" style={{ padding: '0.3rem', marginLeft: 8, flexShrink: 0 }}><X size={18} /></button>
              </div>

              {/* Message history */}
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16, paddingRight: 4 }}>
                {ticketDetail.messages.map((m) => (
                  <div
                    key={m.id}
                    style={{
                      alignSelf: m.sender === 'client' ? 'flex-end' : 'flex-start',
                      maxWidth: '80%',
                      background: m.sender === 'client' ? 'linear-gradient(135deg,#f59e0b,#f97316)' : 'rgba(255,255,255,0.06)',
                      border: m.sender === 'admin' ? '1px solid rgba(255,255,255,0.1)' : 'none',
                      borderRadius: m.sender === 'client' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                      padding: '0.6rem 0.85rem',
                    }}
                  >
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, marginBottom: 3, color: m.sender === 'client' ? 'rgba(0,0,0,0.6)' : '#f59e0b' }}>
                      {m.sender === 'client' ? 'Tu' : 'SolarDino'}
                    </div>
                    <div style={{ fontSize: '0.85rem', color: m.sender === 'client' ? '#000' : 'var(--text-primary)', whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>{m.text}</div>
                    <div style={{ fontSize: '0.65rem', color: m.sender === 'client' ? 'rgba(0,0,0,0.5)' : 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>
                      {new Date(m.created_at).toLocaleString('it-IT', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' })}
                    </div>
                  </div>
                ))}
              </div>

              {ticketActionMsg && (
                <div style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.25)', borderRadius: 10, padding: '0.5rem 0.75rem', fontSize: '0.8rem', color: '#22c55e', marginBottom: 10 }}>
                  {ticketActionMsg}
                </div>
              )}

              {/* Reply box (only if ticket not closed) */}
              {ticketDetail.status !== 'risolto' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <textarea
                    className="form-input"
                    rows={3}
                    placeholder="Scrivi un messaggio..."
                    value={ticketReplyText}
                    onChange={(e) => setTicketReplyText(e.target.value)}
                    style={{ resize: 'none', fontSize: '0.85rem', background: '#0d1117', color: '#f1f5f9', borderColor: 'rgba(255,255,255,0.12)' }}
                  />
                  <div className="flex gap-2">
                    <button
                      className="btn-amber flex-1"
                      style={{ fontSize: '0.85rem', padding: '0.6rem' }}
                      disabled={ticketReplyLoading || !ticketReplyText.trim()}
                      onClick={sendTicketReply}
                    >
                      {ticketReplyLoading ? 'Invio...' : 'Invia messaggio'}
                    </button>
                    <button
                      className="btn-ghost"
                      style={{ fontSize: '0.85rem', padding: '0.6rem 1rem', color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }}
                      onClick={handleCloseTicket}
                    >
                      Chiudi ticket
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 12, padding: '0.85rem 1rem', fontSize: '0.82rem', color: '#f87171', lineHeight: 1.6 }}>
                  {clientClosedTicketIds.has(ticketDetail.id)
                    ? <><strong>Ticket chiuso da te.</strong></>
                    : <><strong>Ticket chiuso dall'amministratore.</strong></>
                  }{' '}Non è possibile aggiungere nuovi messaggi a questo ticket. Per ulteriore assistenza, apri una nuova segnalazione.
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  )
}
