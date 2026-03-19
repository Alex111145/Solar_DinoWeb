const BASE = ''

// Mantenuto per retrocompatibilità con eventuali chiamate dirette
export function authHeaders(): Record<string, string> {
  return {}
}

export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  try {
    const res = await fetch(BASE + path, {
      ...opts,
      credentials: 'include',   // invia il cookie HttpOnly automaticamente
      headers: {
        ...(opts.headers || {}),
      },
    })

    if (res.status === 401) {
      // Token scaduto o non valido — cancella cookie + localStorage e vai al login
      await fetch('/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {})
      localStorage.clear()
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login'
      }
      return res
    }

    return res
  } catch (err) {
    // Errore di rete (server offline, timeout) — non crashare, ritorna una risposta fake
    console.warn('[apiFetch] Errore di rete:', path, err)
    return new Response(JSON.stringify({ detail: 'Errore di rete' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}
