import { Navigate, Route, Routes } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import DashboardPage from './pages/DashboardPage'
import AdminPage from './pages/AdminPage'
import CookieBanner from './components/CookieBanner'

// Auth check: il token è nel cookie HttpOnly, usiamo 'email' come indicatore di sessione attiva
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const loggedIn = !!localStorage.getItem('email')
  if (!loggedIn) return <Navigate to="/login" replace />
  return <>{children}</>
}

function AdminRoute({ children }: { children: React.ReactNode }) {
  const loggedIn = !!localStorage.getItem('email')
  const isAdmin = localStorage.getItem('is_admin') === 'true'
  if (!loggedIn) return <Navigate to="/login" replace />
  if (!isAdmin) return <Navigate to="/dashboard" replace />
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
