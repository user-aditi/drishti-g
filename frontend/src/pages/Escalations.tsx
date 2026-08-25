import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import {
  CardSkeleton,
  EmptyState,
  ErrorBanner,
  PageHeader,
  PriorityPill,
  Spinner,
  StatusPill,
} from '../components/ui'
import { isAuthorityWide, relativeTime } from '../lib/format'
import type { EscalationInboxItem } from '../lib/types'

/**
 * Complaints that became this officer's problem because someone below them
 * missed a deadline.
 *
 * This queue is the point of having a hierarchy at all — without it, an
 * unresolved complaint just sits where it was first assigned and nobody senior
 * ever learns it is stuck.
 */
export default function Escalations() {
  const { user } = useAuth()
  const [items, setItems] = useState<EscalationInboxItem[]>([])
  const [loading, setLoading] = useState(true)
  const [sweeping, setSweeping] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await api.escalationInbox()
      setItems(res.items)
    } catch {
      setError('Could not load your escalations.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function acknowledge(id: number) {
    setBusyId(id)
    try {
      await api.acknowledgeEscalation(id)
      await load()
    } catch {
      setError('Could not acknowledge that.')
    } finally {
      setBusyId(null)
    }
  }

  async function sweep() {
    setSweeping(true)
    try {
      await api.runEscalationSweep()
      await load()
    } catch {
      setError('Could not run the sweep.')
    } finally {
      setSweeping(false)
    }
  }

  const pending = items.filter((i) => i.acknowledgedAt == null)

  return (
    <div>
      <PageHeader
        title="Escalated to me"
        description="Complaints that missed their deadline further down the chain and are now your responsibility."
        action={
          user != null && isAuthorityWide(user.rank) ? (
            <button onClick={() => void sweep()} className="btn-secondary" disabled={sweeping}>
              {sweeping && <Spinner />}
              Run escalation sweep
            </button>
          ) : undefined
        }
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton rows={2} />
          <CardSkeleton rows={2} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon="✅"
          title="Nothing escalated to you"
          description="When a complaint below you passes its deadline, it lands here with the reason."
        />
      ) : (
        <>
          {pending.length > 0 && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <strong className="tnum">{pending.length}</strong> escalation
              {pending.length === 1 ? '' : 's'} still unacknowledged.
            </div>
          )}

          <div className="space-y-3">
            {items.map((e) => (
              <div
                key={e.id}
                className={`card p-4 ${
                  e.acknowledgedAt == null ? 'border-l-4 border-l-purple-500' : 'opacity-70'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-lg"
                    aria-hidden
                  >
                    {e.complaint.category?.icon ?? '⬆️'}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 flex-1 font-medium text-slate-900">
                        {e.complaint.title}
                      </h3>
                      <div className="flex shrink-0 gap-1.5">
                        <StatusPill status={e.complaint.status} />
                        {e.complaint.priority !== 'MEDIUM' && (
                          <PriorityPill priority={e.complaint.priority} />
                        )}
                      </div>
                    </div>

                    <p className="mt-1.5 rounded-lg bg-purple-50 px-3 py-2 text-sm text-purple-900">
                      <span className="font-medium">From {e.fromRankLabel}:</span> {e.reason}
                    </p>

                    <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                      <span className="font-mono text-[11px] text-slate-400">
                        {e.complaint.referenceNo}
                      </span>
                      {e.complaint.sector && <span>Sector {e.complaint.sector.number}</span>}
                      {e.complaint.department && <span>{e.complaint.department.name}</span>}
                      <span>escalated {relativeTime(e.createdAt)}</span>
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                      {e.acknowledgedAt == null ? (
                        <button
                          onClick={() => void acknowledge(e.id)}
                          className="btn-primary btn-sm"
                          disabled={busyId === e.id}
                        >
                          {busyId === e.id && <Spinner className="h-3 w-3" />}
                          Acknowledge
                        </button>
                      ) : (
                        <span className="pill bg-emerald-100 text-emerald-800">
                          Acknowledged {relativeTime(e.acknowledgedAt)}
                        </span>
                      )}
                      <Link to={`/complaints/${e.complaint.id}`} className="btn-secondary btn-sm">
                        Open case file
                      </Link>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
