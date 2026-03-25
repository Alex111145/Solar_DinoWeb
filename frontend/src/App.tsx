import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import CookieBanner from './components/CookieBanner'

type AuthState = 'loading' | 'ok' | 'unauth' | 'not_admin'

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>('loading')

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then((r) => {
        if (!r.ok) { setState('unauth'); return }
        setState('ok')
      })
      .catch(() => setState('unauth'))
  }, [])

  if (state === 'loading') return null
  if (state === 'unauth') return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>('loading')

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) { setState('unauth'); return }
        const data = await r.json()
        setState(data.is_admin ? 'ok' : 'not_admin')
      })
      .catch(() => setState('unauth'))
  }, [])

  if (state === 'loading') return null
  if (state === 'unauth') return <Navigate to="/login" replace />
  if (state === 'not_admin') return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <>
    <CookieBanner />
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <DashboardPage />
          </ProtectedRoute>
        }
      />
      <Route
        path="/admin"
        element={
          <AdminRoute>
            <AdminPage />
          </AdminRoute>
        }
      />
    </Routes>
    </>
  )
}
