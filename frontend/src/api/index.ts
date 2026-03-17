const BASE = ''

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${localStorage.getItem('token') || ''}` }
}

export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const res = await fetch(BASE + path, {
    ...opts,
    headers: {
      ...authHeaders(),
      ...(opts.headers || {}),
    },
  })
  if (res.status === 401) {
    localStorage.clear()
    throw new Error('UNAUTHORIZED')
  }
  return res
}
