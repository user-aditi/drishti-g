import { Navigate, useLocation } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { RANK_LEVEL } from '../lib/format'
import type { Rank } from '../lib/types'
import { Spinner } from './ui'

export default function ProtectedRoute({
  children,
  minRank,
}: {
  children: ReactNode
  /** Minimum seniority. Omit to allow any signed-in user. */
  minRank?: Rank
}) {
  const { user, loading } = useAuth()
  const location = useLocation()

  // Session restore is still in flight. A spinner beats flashing the login page
  // at someone who is already signed in.
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-slate-400">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />

  // Gating on seniority rather than an exact role means a General Manager can
  // open a Section Officer's screen without every route listing every rank.
  if (minRank && RANK_LEVEL[user.rank] < RANK_LEVEL[minRank]) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}
