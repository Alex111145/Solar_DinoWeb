import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Cookie, ChevronDown, ChevronUp, Shield } from 'lucide-react'

const STORAGE_KEY = 'cookie_consent'

type ConsentChoice = 'all' | 'necessary' | null

export default function CookieBanner() {
  const [choice, setChoice] = useState<ConsentChoice>(null)
  const [showDetail, setShowDetail] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'all' || saved === 'necessary') setChoice(saved)
  }, [])

  function accept(type: 'all' | 'necessary') {
    localStorage.setItem(STORAGE_KEY, type)
    setChoice(type)
  }

  if (choice !== null) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ y: 120, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 120, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          width: '100%',
          background: 'rgba(10,13,22,0.97)',
          backdropFilter: 'blur(20px)',
          borderTop: '1px solid rgba(245,158,11,0.25)',
          padding: '18px 32px',
          zIndex: 9999,
          boxShadow: '0 -8px 40px rgba(0,0,0,0.5)',
        }}
      >
        {/* Layout a riga intera */}
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>

          {/* Icona + testo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 260 }}>
            <div style={{ background: 'rgba(245,158,11,0.15)', borderRadius: 10, padding: 8, flexShrink: 0 }}>
              <Cookie size={18} color="#f59e0b" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: '0.88rem', color: '#f1f5f9', marginBottom: 2 }}>
                Utilizziamo i cookie
              </div>
              <p style={{ fontSize: '0.78rem', color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
                Cookie tecnici necessari per autenticazione e sessione, e cookie analitici opzionali per migliorare l'esperienza.
                Vedi la nostra <span style={{ color: '#64748b', textDecoration: 'underline', cursor: 'pointer' }}>Privacy Policy</span>.
              </p>
            </div>
          </div>

          {/* Dettagli espandibili */}
          <button
            onClick={() => setShowDetail((v) => !v)}
            className="flex items-center gap-1"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', fontSize: '0.78rem', padding: 0, whiteSpace: 'nowrap', flexShrink: 0 }}
          >
            {showDetail ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
            {showDetail ? 'Nascondi dettagli' : 'Mostra dettagli'}
          </button>

          {/* Bottoni */}
          <div style={{ display: 'flex', gap: 10, flexShrink: 0 }}>
            <button
              onClick={() => accept('necessary')}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.12)',
                borderRadius: 10, padding: '9px 20px',
                fontSize: '0.82rem', fontWeight: 600, color: '#94a3b8',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              Solo necessari
            </button>
            <button
              onClick={() => accept('all')}
              style={{
                background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                border: 'none',
                borderRadius: 10, padding: '9px 20px',
                fontSize: '0.82rem', fontWeight: 700, color: '#0f172a',
                cursor: 'pointer', whiteSpace: 'nowrap',
                boxShadow: '0 4px 14px rgba(245,158,11,0.35)',
              }}
            >
              Accetta tutti
            </button>
          </div>
        </div>

        {/* Dettagli espansi — sotto la riga principale */}
        <AnimatePresence>
          {showDetail && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              style={{ overflow: 'hidden' }}
            >
              <div style={{ maxWidth: 1400, margin: '12px auto 0', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {[
                  { icon: <Shield size={13} color="#34d399" />, label: 'Cookie necessari', desc: 'Sessione di autenticazione (HttpOnly, sicuro). Non disattivabili.', required: true },
                  { icon: <Cookie size={13} color="#f59e0b" />, label: 'Cookie analitici', desc: 'Preferenze UI (tema scuro/chiaro) e statistiche di utilizzo anonime.', required: false },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="flex items-start gap-2 rounded-xl px-3 py-2"
                    style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', flex: 1, minWidth: 220 }}
                  >
                    <span style={{ marginTop: 1 }}>{item.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#e2e8f0' }}>{item.label}</div>
                      <div style={{ fontSize: '0.73rem', color: '#64748b', marginTop: 2 }}>{item.desc}</div>
                    </div>
                    <span style={{ fontSize: '0.68rem', fontWeight: 600, padding: '2px 8px', borderRadius: 6, background: item.required ? 'rgba(52,211,153,0.12)' : 'rgba(245,158,11,0.12)', color: item.required ? '#34d399' : '#f59e0b', whiteSpace: 'nowrap' }}>
                      {item.required ? 'Sempre attivo' : 'Opzionale'}
                    </span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  )
}
