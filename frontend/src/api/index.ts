const BASE = ''

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
}

export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  try {
    const res = await fetch(BASE + path, {
      ...opts,
      headers: {
        ...authHeaders(),
        ...(opts.headers || {}),
      },
    })

    if (res.status === 401) {
      // Token scaduto o non valido — pulisci e vai al login senza crashare
      localStorage.clear()
      if (!window.location.pathname.includes('/login')) {
        window.location.href = '/login'
      }
      // Ritorna la risposta invece di throw, così i componenti non crashano
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
