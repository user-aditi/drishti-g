import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import type { UserRole } from '../lib/types'
import { Spinner } from './ui'

export default function ProtectedRoute({
  children,
  roles,
}: {
  children: ReactNode
  /** Omit to allow any signed-in user. */
  roles?: UserRole[]
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  // Session restore is still in flight. Showing a spinner beats flashing the
  // login page at someone who is already signed in.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />

  return <>{children}</>
}
