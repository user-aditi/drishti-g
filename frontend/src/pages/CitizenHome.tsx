import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import ComplaintCard from '../components/ComplaintCard'
import { CardSkeleton, EmptyState, ErrorBanner, PageHeader, StatTile } from '../components/ui'
import { isOpen } from '../lib/format'
import type { Complaint, ComplaintStats } from '../lib/types'

type Filter = 'all' | 'open' | 'resolved'

export default function CitizenHome() {
  const { user } = useAuth()
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [stats, setStats] = useState<ComplaintStats | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [list, s] = await Promise.all([api.complaints({ size: 50 }), api.complaintStats()])
      setComplaints(list.items)
      setStats(s)
    } catch {
      setError('Could not load your complaints.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  // Filtering happens client-side: a citizen's own list is small enough that a
  // round trip per tab would be slower than the render.
  const visible = complaints.filter((c) => {
    if (filter === 'open') return isOpen(c.status)
    if (filter === 'resolved') return ['RESOLVED', 'CLOSED'].includes(c.status)
    return true
  })

  const firstName = user?.fullName.split(' ')[0] ?? ''

  return (
    <div>
      <PageHeader
        title={`Welcome back, ${firstName}`}
        description="Track the issues you have reported and file new ones."
        action={
          <Link to="/complaints/new" className="btn-primary">
            <span aria-hidden>➕</span> Report an issue
          </Link>
        }
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {stats && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <StatTile label="Total reported" value={stats.total} icon={<span className="text-2xl">📋</span>} />
          <StatTile
            label="Still open"
            value={stats.open}
            tone={stats.open > 0 ? 'warning' : 'default'}
            icon={<span className="text-2xl">⏳</span>}
          />
          <StatTile
            label="Resolved"
            value={stats.resolved}
            tone="success"
            icon={<span className="text-2xl">✅</span>}
          />
        </div>
      )}

      <div className="mb-4 flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['all', 'All'],
            ['open', 'Open'],
            ['resolved', 'Resolved'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton rows={2} />
          <CardSkeleton rows={2} />
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={filter === 'all' ? '📭' : '🔍'}
          title={filter === 'all' ? 'No complaints yet' : `Nothing ${filter}`}
          description={
            filter === 'all'
              ? 'When you report a civic issue, it will appear here with its full status history.'
              : 'Try a different filter to see your other complaints.'
          }
          action={
            filter === 'all' ? (
              <Link to="/complaints/new" className="btn-primary">
                File your first complaint
              </Link>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((c) => (
            <ComplaintCard key={c.id} complaint={c} to={`/complaints/${c.id}`} />
          ))}
        </div>
      )}
    </div>
  )
}
