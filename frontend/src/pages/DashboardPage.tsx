import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Sun, Upload, CreditCard, History, Star, LogOut,
  X, Play, FileDown, Check, AlertTriangle, Trash2,
  Mail, Lock, Building2, ChevronRight, Zap,
} from 'lucide-react'
import { apiFetch } from '../api'

// ── Types ──────────────────────────────────────────────────────────────────
interface Job {
  id: string
  filename?: string
  created_at?: string
  status: string
  panel_count?: number
  error_message?: string
}

interface Package {
  key: string
  label: string
  credits: number
  price_eur: number
  popular?: boolean
}

interface Review {
  id: string
  company?: string
  stars: number
  comment?: string
  created_at?: string
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
          <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontWeight: 500 }}>{label}</span>
          <span style={{ fontSize: '0.72rem', color: '#475569' }}>Clicca o trascina</span>
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
          <h3 style={{ color: '#f1f5f9', fontSize: '1.1rem', fontWeight: 700 }}>Consenso al trattamento dati</h3>
          <button onClick={onClose} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
        </div>
        <p style={{ fontSize: '0.875rem', color: '#94a3b8', lineHeight: 1.7, marginBottom: '1.25rem' }}>
          I file che stai per caricare potrebbero contenere dati geografici e informazioni sull'impianto fotovoltaico.
          Questi dati saranno trattati esclusivamente per la generazione del report di analisi termografica e non
          saranno condivisi con terze parti. Il trattamento è effettuato nel rispetto del Regolamento (UE) 2016/679 (GDPR).
        </p>
        <label className="flex items-start gap-3 cursor-pointer mb-6">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} style={{ marginTop: 2 }} />
          <span style={{ fontSize: '0.875rem', color: '#94a3b8' }}>
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

// ── Info Modal ─────────────────────────────────────────────────────────────
// ── Profile Sidebar ────────────────────────────────────────────────────────
function ProfileSidebar({
  name, email, ragioneSociale, vatNumber, history, downloadFile, myReview, onReviewUpdate, onClose,
}: {
  name: string
  email: string
  ragioneSociale: string
  vatNumber: string
  history: Job[]
  downloadFile: (jobId: string, format: string) => void
  myReview: Review | null
  onReviewUpdate: (r: Review) => void
  onClose: () => void
}) {
  const navigate = useNavigate()
  const [openSection, setOpenSection] = useState<string | null>(null)
  const [newEmail, setNewEmail] = useState('')
  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [msg, setMsg] = useState('')
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [editStars, setEditStars] = useState(myReview?.stars ?? 0)
  const [editComment, setEditComment] = useState(myReview?.comment ?? '')
  const [reviewMsg, setReviewMsg] = useState('')

  useEffect(() => {
    if (myReview) {
      setEditStars(myReview.stars)
      setEditComment(myReview.comment ?? '')
    }
  }, [myReview])

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

  async function changeEmail() {
    try {
      const res = await apiFetch('/auth/change-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail }),
      })
      if (res.ok) { setMsg('Email aggiornata'); localStorage.setItem('email', newEmail) }
      else setMsg('Errore aggiornamento email')
    } catch { setMsg('Errore') }
  }

  async function changePassword() {
    try {
      const res = await apiFetch('/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
      })
      if (res.ok) setMsg('Password aggiornata')
      else setMsg('Errore: password attuale errata')
    } catch { setMsg('Errore') }
  }

  async function deleteAccount() {
    try {
      await apiFetch('/auth/delete-account', { method: 'DELETE' })
      localStorage.clear()
      navigate('/login')
    } catch { setMsg('Errore eliminazione account') }
  }

  function logout() {
    localStorage.clear()
    navigate('/login')
  }

  const initials = name ? name.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) : '??'

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
          background: '#0d1117',
          borderLeft: '1px solid rgba(255,255,255,0.08)',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ padding: '1.5rem', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div className="flex items-center justify-between mb-4">
            <span style={{ color: '#94a3b8', fontSize: '0.875rem', fontWeight: 600 }}>Profilo</span>
            <button onClick={onClose} className="btn-ghost" style={{ padding: '0.3rem' }}><X size={18} /></button>
          </div>
          <div className="flex items-center gap-4">
            <div
              className="flex items-center justify-center rounded-full flex-shrink-0"
              style={{ width: 52, height: 52, background: 'linear-gradient(135deg,#f59e0b,#f97316)', color: '#000', fontWeight: 700, fontSize: '1.1rem' }}
            >
              {initials}
            </div>
            <div>
              <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.975rem' }}>{name}</div>
              <div style={{ color: '#64748b', fontSize: '0.8rem' }}>{email}</div>
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

          {/* Info azienda */}
          <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
            <button
              className="w-full flex items-center justify-between p-4"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f1f5f9' }}
              onClick={() => toggle('info')}
            >
              <span className="flex items-center gap-2 text-sm font-medium"><Building2 size={15} /> Info azienda</span>
              <ChevronRight size={15} style={{ transform: openSection === 'info' ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: '#64748b' }} />
            </button>
            {openSection === 'info' && (
              <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex flex-col gap-2" style={{ marginTop: '0.75rem', marginBottom: '1rem' }}>
                  {[
                    { label: 'Ragione sociale', value: ragioneSociale || '—' },
                    { label: 'Partita IVA', value: vatNumber || '—' },
                    { label: 'Nome referente', value: name || '—' },
                    { label: 'Email', value: email || '—' },
                    { label: 'Password', value: '••••••••' },
                  ].map(({ label, value }) => (
                    <div key={label} style={{ padding: '0.6rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                      <div style={{ fontSize: '0.68rem', color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                      <div style={{ fontSize: '0.85rem', color: label === 'Password' ? '#475569' : '#f1f5f9', fontWeight: 500 }}>{value}</div>
                    </div>
                  ))}
                </div>
                <p style={{ fontSize: '0.75rem', color: '#475569', marginBottom: '0.75rem' }}>
                  Per modificare email o password usa le sezioni dedicate. Per altri dati contatta il supporto.
                </p>
                {!deleteConfirm ? (
                  <button
                    className="flex items-center gap-2"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '0.8rem', fontWeight: 600 }}
                    onClick={() => setDeleteConfirm(true)}
                  >
                    <Trash2 size={13} /> Elimina account
                  </button>
                ) : (
                  <div>
                    <p style={{ fontSize: '0.8rem', color: '#ef4444', marginBottom: 8 }}>Sei sicuro? Questa azione è irreversibile.</p>
                    <div className="flex gap-2">
                      <button className="btn-ghost" style={{ fontSize: '0.75rem', padding: '0.4rem 0.75rem' }} onClick={() => setDeleteConfirm(false)}>Annulla</button>
                      <button
                        style={{ background: '#ef4444', border: 'none', borderRadius: 8, padding: '0.4rem 0.75rem', color: '#fff', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer' }}
                        onClick={deleteAccount}
                      >
                        Elimina definitivamente
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Cambia email */}
          <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
            <button
              className="w-full flex items-center justify-between p-4"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f1f5f9' }}
              onClick={() => toggle('email')}
            >
              <span className="flex items-center gap-2 text-sm font-medium"><Mail size={15} /> Cambia email</span>
              <ChevronRight size={15} style={{ transform: openSection === 'email' ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: '#64748b' }} />
            </button>
            {openSection === 'email' && (
              <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <input
                  className="form-input mt-3"
                  type="email"
                  placeholder="Nuova email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  style={{ fontSize: '0.85rem' }}
                />
                <button className="btn-amber w-full mt-3" style={{ fontSize: '0.85rem', padding: '0.6rem' }} onClick={changeEmail}>
                  Aggiorna email
                </button>
              </div>
            )}
          </div>

          {/* Cambia password */}
          <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
            <button
              className="w-full flex items-center justify-between p-4"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f1f5f9' }}
              onClick={() => toggle('pwd')}
            >
              <span className="flex items-center gap-2 text-sm font-medium"><Lock size={15} /> Cambia password</span>
              <ChevronRight size={15} style={{ transform: openSection === 'pwd' ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: '#64748b' }} />
            </button>
            {openSection === 'pwd' && (
              <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <input
                  className="form-input mt-3"
                  type="password"
                  placeholder="Password attuale"
                  value={oldPwd}
                  onChange={(e) => setOldPwd(e.target.value)}
                  style={{ fontSize: '0.85rem', marginBottom: 8 }}
                />
                <input
                  className="form-input"
                  type="password"
                  placeholder="Nuova password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  style={{ fontSize: '0.85rem' }}
                />
                <button className="btn-amber w-full mt-3" style={{ fontSize: '0.85rem', padding: '0.6rem' }} onClick={changePassword}>
                  Aggiorna password
                </button>
              </div>
            )}
          </div>

          {/* Storico elaborazioni */}
          <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
            <button
              className="w-full flex items-center justify-between p-4"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f1f5f9' }}
              onClick={() => toggle('storico')}
            >
              <span className="flex items-center gap-2 text-sm font-medium"><History size={15} /> Storico elaborazioni</span>
              <ChevronRight size={15} style={{ transform: openSection === 'storico' ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: '#64748b' }} />
            </button>
            {openSection === 'storico' && (
              <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {history.length === 0 ? (
                  <p style={{ color: '#475569', fontSize: '0.8rem', textAlign: 'center', padding: '1rem 0' }}>
                    Nessuna elaborazione ancora.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2 mt-3">
                    {history.map((job) => (
                      <div key={job.id} style={{ padding: '0.65rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: 10, border: '1px solid rgba(255,255,255,0.06)' }}>
                        <div className="flex items-center justify-between mb-1">
                          <span style={{ fontSize: '0.78rem', color: '#f1f5f9', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                            {job.filename || `Job ${job.id.slice(0, 8)}`}
                          </span>
                          <span className={`badge ${job.status === 'completato' ? 'badge-green' : job.status === 'errore' ? 'badge-red' : 'badge-amber'}`} style={{ fontSize: '0.65rem' }}>
                            {statusLabel(job.status)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: '0.7rem', color: '#475569' }}>
                            {job.created_at ? new Date(job.created_at).toLocaleDateString('it-IT') : '—'}
                            {job.panel_count != null ? ` · ${job.panel_count} pannelli` : ''}
                          </span>
                          {job.status === 'completato' && (
                            <div className="flex gap-1">
                              {['kml', 'json', 'csv'].map((fmt) => (
                                <button
                                  key={fmt}
                                  onClick={() => downloadFile(job.id, fmt)}
                                  className="btn-ghost"
                                  style={{ padding: '0.2rem 0.45rem', fontSize: '0.65rem', textTransform: 'uppercase' }}
                                >
                                  {fmt}
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
          </div>
          {/* Modifica recensione */}
          {myReview && (
            <div className="card mb-2" style={{ padding: 0, borderRadius: 14, overflow: 'hidden' }}>
              <button
                className="w-full flex items-center justify-between p-4"
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f1f5f9' }}
                onClick={() => toggle('recensione')}
              >
                <span className="flex items-center gap-2 text-sm font-medium"><Star size={15} /> Modifica recensione</span>
                <ChevronRight size={15} style={{ transform: openSection === 'recensione' ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', color: '#64748b' }} />
              </button>
              {openSection === 'recensione' && (
                <div style={{ padding: '0 1rem 1rem', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
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
        </div>

        {/* Logout */}
        <div style={{ padding: '1rem', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          <button
            className="w-full flex items-center justify-center gap-2 btn-ghost"
            style={{ color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)', width: '100%' }}
            onClick={logout}
          >
            <LogOut size={15} /> Esci dall'account
          </button>
        </div>
      </motion.div>
    </>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────────────
export default function DashboardPage() {
  const navigate = useNavigate()

  // User state
  const [userName, setUserName] = useState(localStorage.getItem('name') || '')
  const [userEmail, setUserEmail] = useState(localStorage.getItem('email') || '')
  const [credits, setCredits] = useState(parseInt(localStorage.getItem('credits') || '0'))
  const [ragioneSociale, setRagioneSociale] = useState(localStorage.getItem('ragione_sociale') || '')
  const [vatNumber, setVatNumber] = useState(localStorage.getItem('vat_number') || '')

  // UI state

  const [showProfile, setShowProfile] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  // Upload state
  const [thermalTif, setThermalTif] = useState<File | null>(null)
  const [thermalTfw, setThermalTfw] = useState<File | null>(null)
  const [rgbTif, setRgbTif] = useState<File | null>(null)
  const [rgbTfw, setRgbTfw] = useState<File | null>(null)
  const [panelData, setPanelData] = useState({ marca: '', modello: '', dimensioni: '', efficienza: '', coefficiente: '' })
  const [showConsent, setShowConsent] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // Job polling
  const [activeJob, setActiveJob] = useState<Job | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // History
  const [history, setHistory] = useState<Job[]>([])

  // Payments
  const [payTab, setPayTab] = useState<'carta' | 'bonifico'>('carta')
  const [packages, setPackages] = useState<Package[]>([])
  const [bonificoReceipt, setBonificoReceipt] = useState<File | null>(null)
  const bonificoRef = useRef<HTMLInputElement>(null)
  const [bonificoMsg, setBonificoMsg] = useState('')

  // Reviews
  const [reviews, setReviews] = useState<Review[]>([])
  const [myReview, setMyReview] = useState<Review | null>(null)
  const [starValue, setStarValue] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [reviewMsg, setReviewMsg] = useState('')

  // ── Load user data ─────────────────────────────────────────────────────
  useEffect(() => {
    apiFetch('/auth/me')
      .then((r) => r.json())
      .then((d) => {
        setUserName(d.name || d.user?.name || userName)
        setUserEmail(d.email || d.user?.email || userEmail)
        const c = d.credits ?? d.user?.credits ?? credits
        setCredits(c)
        if (d.ragione_sociale) { setRagioneSociale(d.ragione_sociale); localStorage.setItem('ragione_sociale', d.ragione_sociale) }
        if (d.vat_number) { setVatNumber(d.vat_number); localStorage.setItem('vat_number', d.vat_number) }
        localStorage.setItem('name', d.name || d.user?.name || userName)
        localStorage.setItem('email', d.email || d.user?.email || userEmail)
        localStorage.setItem('credits', String(c))
      })
      .catch(() => {})

    apiFetch('/missions/history')
      .then((r) => r.json())
      .then((d) => setHistory(Array.isArray(d) ? d : d.missions || []))
      .catch(() => {})

    apiFetch('/payments/packages')
      .then((r) => r.json())
      .then((d) => setPackages(Array.isArray(d) ? d : d.packages || []))
      .catch(() => {})

    apiFetch('/reviews')
      .then((r) => r.json())
      .then((d) => setReviews(Array.isArray(d) ? d : d.reviews || []))
      .catch(() => {})

    apiFetch('/reviews/mine')
      .then((r) => r.json())
      .then((d) => { if (d && d.id) setMyReview(d) })
      .catch(() => {})
  }, [])

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
              localStorage.setItem('credits', String(c))
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
  async function buyPackage(pkg: Package) {
    try {
      const res = await apiFetch('/payments/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ package: pkg.key }),
      })
      const d = await res.json()
      if (d.checkout_url || d.url) window.location.href = d.checkout_url || d.url
    } catch { }
  }

  async function sendBonifico() {
    if (!bonificoReceipt) { setBonificoMsg('Allega la ricevuta'); return }
    try {
      const fd = new FormData()
      fd.append('receipt', bonificoReceipt)
      const res = await apiFetch('/payments/bonifico-request', { method: 'POST', body: fd })
      if (res.ok) setBonificoMsg('Richiesta inviata! Riceverai conferma via email.')
      else setBonificoMsg('Errore invio')
    } catch { setBonificoMsg('Errore') }
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
    <div className="min-h-screen" style={{ background: '#060912', position: 'relative' }}>
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
            <span style={{ fontWeight: 700, fontSize: '1.05rem', color: '#f1f5f9', letterSpacing: '-0.02em' }}>SolarDino</span>
          </div>

          <div className="flex items-center gap-2">
            <div
              className="badge badge-amber"
              style={{ cursor: 'default' }}
            >
              <Zap size={12} /> {credits} elaborazioni
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
              <strong>Crediti esauriti.</strong> Acquista un pacchetto per continuare le elaborazioni.
            </span>
          </motion.div>
        )}

        {/* Welcome */}
        <motion.div variants={cardAnim} className="mb-8">
          <h1 style={{ fontSize: 'clamp(1.6rem, 3vw, 2.2rem)', fontWeight: 800, letterSpacing: '-0.03em', color: '#f1f5f9', marginBottom: 6 }}>
            Benvenuto,{' '}
            <span className="text-amber-gradient">{userName || 'utente'}</span>
          </h1>
          <p style={{ color: '#64748b', fontSize: '0.925rem' }}>
            Carica due ortomosaici per avviare l'analisi AI.
          </p>
        </motion.div>

        {/* Video demo */}
        <motion.div variants={cardAnim} className="card mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Play size={15} style={{ color: '#f59e0b' }} />
            <span style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.925rem' }}>Come funziona SolarDino</span>
          </div>
          <div className="rounded-xl overflow-hidden" style={{ border: '1px solid rgba(255,255,255,0.07)' }}>
            <video
              controls
              style={{ width: '100%', display: 'block', maxHeight: 400, background: '#000' }}
              src="https://msyvtrsgxfderbyametg.supabase.co/storage/v1/object/sign/pth/g.mp4?token=eyJraWQiOiJzdG9yYWdlLXVybC1zaWduaW5nLWtleV85ZjNjY2UxNi1hMmJmLTQ5OGQtOTBiOS02NDEyZTI4ZmJlZDAiLCJhbGciOiJIUzI1NiJ9.eyJ1cmwiOiJwdGgvZy5tcDQiLCJpYXQiOjE3NzM3NTAyNTQsImV4cCI6NDM2MzE1ODI1NH0.wTGPATzAYIhwAfcgWGVx03T9tE98tF5WSEICr57OyPE" />
          </div>
        </motion.div>

        {/* Upload card */}
        <motion.div variants={cardAnim} className="card mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
              <Upload size={17} />
            </div>
            <div>
              <h2 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Nuova Elaborazione</h2>
              <p style={{ color: '#64748b', fontSize: '0.8rem', margin: 0 }}>Carica i file ortomosaico per avviare l'analisi</p>
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
              <span style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Dati pannelli
              </span>
              <span style={{ fontSize: '0.72rem', color: '#475569', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 6, padding: '1px 6px' }}>
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
            <Zap size={16} />
            {uploading ? 'Caricamento...' : 'Avvia Elaborazione AI'}
          </button>
          {credits <= 0 && (
            <span style={{ fontSize: '0.8rem', color: '#ef4444', marginLeft: 12 }}>Crediti insufficienti</span>
          )}
        </motion.div>

        {/* Active job — floating popup (rendered outside flow at bottom of return) */}

        {/* Credits / Payments */}
        <motion.div variants={cardAnim} className="card mb-6">
          <div className="flex items-center gap-3 mb-5">
            <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
              <CreditCard size={17} />
            </div>
            <div>
              <h2 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Acquista Elaborazioni</h2>
              <p style={{ color: '#64748b', fontSize: '0.8rem', margin: 0 }}>Crediti disponibili: <strong style={{ color: '#f59e0b' }}>{credits}</strong></p>
            </div>
          </div>

          <div className="flex gap-2 mb-5">
            <button className={`tab-btn ${payTab === 'carta' ? 'active' : ''}`} onClick={() => setPayTab('carta')}>
              Carta di credito
            </button>
            <button className={`tab-btn ${payTab === 'bonifico' ? 'active' : ''}`} onClick={() => setPayTab('bonifico')}>
              Bonifico bancario
            </button>
          </div>

          {payTab === 'carta' && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {(packages.length > 0
                ? packages.map((p, i) => ({ ...p, popular: i === 1 }))
                : [
                    { key: 'single', label: 'Singola', credits: 1, price_eur: 49.99, popular: false },
                    { key: 'pack5', label: 'Pack 5', credits: 5, price_eur: 219.99, popular: true },
                    { key: 'pack10', label: 'Pack 10', credits: 10, price_eur: 399.99, popular: false },
                  ]
              ).map((pkg) => (
                <div
                  key={pkg.key}
                  className="rounded-xl p-4 flex flex-col gap-2"
                  style={{
                    background: pkg.popular ? 'rgba(245,158,11,0.07)' : 'rgba(255,255,255,0.03)',
                    border: pkg.popular ? '1px solid rgba(245,158,11,0.35)' : '1px solid rgba(255,255,255,0.07)',
                    position: 'relative',
                  }}
                >
                  {pkg.popular && (
                    <div
                      style={{
                        position: 'absolute', top: -10, left: '50%', transform: 'translateX(-50%)',
                        background: 'linear-gradient(90deg,#f59e0b,#f97316)', borderRadius: 20,
                        padding: '2px 12px', fontSize: '0.7rem', fontWeight: 700, color: '#000',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      Più popolare
                    </div>
                  )}
                  <span style={{ fontSize: '0.75rem', color: '#f59e0b', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    {pkg.label}
                  </span>
                  <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1.5rem' }}>
                    {pkg.credits} <span style={{ fontSize: '0.85rem', fontWeight: 400, color: '#64748b' }}>elaborazioni</span>
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '0.8rem', flex: 1 }}>
                    €{(pkg.price_eur / pkg.credits).toFixed(2)} per elaborazione
                  </div>
                  <div style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1.25rem', marginBottom: 2 }}>
                    €{pkg.price_eur.toFixed(2)}
                  </div>
                  <button
                    className="btn-amber w-full"
                    style={{ fontSize: '0.85rem', padding: '0.6rem' }}
                    onClick={() => buyPackage(pkg)}
                  >
                    Acquista
                  </button>
                </div>
              ))}
            </div>
          )}

          {payTab === 'bonifico' && (
            <div className="rounded-xl p-5" style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <h3 style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.925rem', marginBottom: 12 }}>Dati per il bonifico</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                {[
                  { label: 'Intestatario', value: 'SolarDino Srl' },
                  { label: 'IBAN', value: 'IT60 X054 2811 1010 0000 0123 456' },
                  { label: 'BIC/SWIFT', value: 'BLOPIT22' },
                  { label: 'Causale', value: 'Acquisto elaborazioni SolarDino' },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ fontSize: '0.72rem', color: '#475569', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: '0.875rem', color: '#f1f5f9', fontWeight: 500 }}>{value}</div>
                  </div>
                ))}
              </div>
              <label className="form-label">Allega ricevuta bonifico</label>
              <div
                className={`drop-zone mb-4 ${bonificoReceipt ? 'has-file' : ''}`}
                onClick={() => bonificoRef.current?.click()}
                style={{ minHeight: 70 }}
              >
                <input ref={bonificoRef} type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => setBonificoReceipt(e.target.files?.[0] || null)} />
                {bonificoReceipt ? (
                  <span style={{ fontSize: '0.8rem', color: '#f59e0b' }}>{bonificoReceipt.name}</span>
                ) : (
                  <span style={{ fontSize: '0.82rem', color: '#94a3b8' }}>PDF, JPG, PNG</span>
                )}
              </div>
              {bonificoMsg && (
                <div className="rounded-xl p-3 mb-3" style={{ background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b', fontSize: '0.85rem' }}>
                  {bonificoMsg}
                </div>
              )}
              <button className="btn-amber" onClick={sendBonifico}>
                <FileDown size={15} /> Invia richiesta
              </button>
            </div>
          )}
        </motion.div>

        {/* Form recensione — sparisce se l'utente ha già recensito */}
        {!myReview && (
          <motion.div variants={cardAnim} className="card mb-6">
            <div className="flex items-center gap-3 mb-5">
              <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
                <Star size={17} />
              </div>
              <h2 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Lascia una recensione</h2>
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

        {/* Recensioni pubbliche degli altri utenti */}
        {reviews.filter((r) => r.id !== myReview?.id).length > 0 && (
          <motion.div variants={cardAnim} className="card mb-6">
            <div className="flex items-center gap-3 mb-5">
              <div style={{ width: 36, height: 36, background: 'rgba(245,158,11,0.12)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#f59e0b' }}>
                <Star size={17} />
              </div>
              <h2 style={{ color: '#f1f5f9', fontWeight: 700, fontSize: '1rem', margin: 0 }}>Recensioni</h2>
            </div>
            <div className="flex flex-col gap-3">
              {reviews.filter((r) => r.id !== myReview?.id).map((r) => (
                <div
                  key={r.id}
                  className="rounded-xl p-4"
                  style={{ background: 'rgba(255,255,255,0.025)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <div className="flex items-center gap-2 mb-1.5">
                    <div className="flex gap-0.5">
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} size={14} fill={n <= r.stars ? '#f59e0b' : 'none'} color={n <= r.stars ? '#f59e0b' : '#475569'} />
                      ))}
                    </div>
                    {r.company && (
                      <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: 500 }}>{r.company}</span>
                    )}
                    <span style={{ fontSize: '0.75rem', color: '#475569', marginLeft: 'auto' }}>
                      {r.created_at ? new Date(r.created_at).toLocaleDateString('it-IT') : ''}
                    </span>
                  </div>
                  {r.comment && <p style={{ fontSize: '0.875rem', color: '#94a3b8', margin: 0 }}>{r.comment}</p>}
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Support footer */}
        <motion.div variants={cardAnim} className="mb-8">
          <div
            className="rounded-2xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4"
            style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <div>
              <div style={{ color: '#f1f5f9', fontWeight: 600, fontSize: '0.925rem', marginBottom: 4 }}>
                Hai bisogno di aiuto?
              </div>
              <div style={{ color: '#64748b', fontSize: '0.85rem' }}>
                Il nostro team è disponibile per supporto tecnico e commerciale.
              </div>
            </div>
            <a
              href="mailto:agervasini1@gmail.com"
              className="btn-ghost flex items-center gap-2"
              style={{ borderColor: 'rgba(245,158,11,0.3)', color: '#f59e0b', whiteSpace: 'nowrap' }}
            >
              <Mail size={15} /> agervasini1@gmail.com
            </a>
          </div>
        </motion.div>
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
        {showProfile && (
          <ProfileSidebar
            name={userName}
            email={userEmail}
            ragioneSociale={ragioneSociale}
            vatNumber={vatNumber}
            history={history}
            downloadFile={downloadFile}
            myReview={myReview}
            onReviewUpdate={(r) => setMyReview(r)}
            onClose={() => setShowProfile(false)}
          />
        )}
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
                <div style={{ color: '#64748b', fontSize: '0.75rem' }}>Analisi AI pannelli solari</div>
              </div>
              {activeJob?.status === 'errore' ? (
                <button
                  onClick={() => setActiveJob(null)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 0, display: 'flex' }}
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
              <span style={{ fontSize: '0.7rem', color: '#475569' }}>
                {activeJob ? `${statusProgress(activeJob.status)}%` : 'Invio…'}
              </span>
              {activeJob && (
                <span style={{ fontSize: '0.7rem', color: '#475569' }}>ID: {activeJob.id.slice(0, 8)}</span>
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
                    'Per assistenza contatta support@solardino.it',
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
    </div>
  )
}
