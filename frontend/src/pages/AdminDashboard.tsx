import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import {
  CardSkeleton,
  ErrorBanner,
  PageHeader,
  RiskBadge,
  SectionHeading,
  StatTile,
} from '../components/ui'
import { STATUS_META } from '../lib/format'
import type { AdminStats, ComplaintStatus, RiskFlag } from '../lib/types'

/** Status order for the funnel — submission through to closure. */
const FUNNEL: ComplaintStatus[] = [
  'SUBMITTED',
  'ROUTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'RESOLVED',
  'CLOSED',
]

function StatusBar({ byStatus, total }: { byStatus: Record<ComplaintStatus, number>; total: number }) {
  const rows = FUNNEL.map((status) => ({ status, count: byStatus[status] ?? 0 })).filter(
    (r) => r.count > 0,
  )

  if (total === 0) return <p className="text-sm text-slate-500">No complaints recorded yet.</p>

  return (
    <div className="space-y-2.5">
      {rows.map(({ status, count }) => {
        const meta = STATUS_META[status]
        const pct = (count / total) * 100
        return (
          <div key={status}>
            <div className="flex items-baseline justify-between text-sm">
              <span className="font-medium text-slate-700">{meta.label}</span>
              <span className="tnum text-slate-500">
                {count}
                <span className="ml-1 text-xs text-slate-400">{pct.toFixed(0)}%</span>
              </span>
            </div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${meta.dot}`}
                style={{ width: `${Math.max(pct, 1.5)}%` }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null)
  const [flags, setFlags] = useState<RiskFlag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [s, queue] = await Promise.all([api.adminStats(), api.riskQueue()])
      setStats(s)
      setFlags(queue.items)
    } catch {
      setError('Could not load the dashboard.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} rows={1} />
          ))}
        </div>
        <CardSkeleton rows={5} />
      </div>
    )
  }

  if (error || !stats) {
    return <ErrorBanner message={error ?? 'No data.'} onRetry={() => void load()} />
  }

  const { complaints, people, departmentBreakdown, avgResolutionDays, pendingFlags } = stats
  const maxDept = Math.max(...departmentBreakdown.map((d) => d.count), 1)

  return (
    <div>
      <PageHeader
        title="Supervisor dashboard"
        description="City-wide oversight, with GRIE surfacing what needs attention first."
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Total complaints"
          value={complaints.total}
          hint={`${people.citizens} registered citizens`}
          icon={<span className="text-2xl">📋</span>}
        />
        <StatTile
          label="Currently open"
          value={complaints.open}
          tone={complaints.open > 0 ? 'warning' : 'default'}
          hint={`${people.officials} active officials`}
          icon={<span className="text-2xl">⏳</span>}
        />
        <StatTile
          label="Past deadline"
          value={complaints.overdue}
          tone={complaints.overdue > 0 ? 'danger' : 'success'}
          hint={
            complaints.open > 0
              ? `${Math.round((complaints.overdue / complaints.open) * 100)}% of open work`
              : 'Nothing overdue'
          }
          icon={<span className="text-2xl">🚨</span>}
        />
        <StatTile
          label="Avg. resolution"
          value={avgResolutionDays == null ? '—' : `${avgResolutionDays}d`}
          hint="Across the last 500 resolutions"
          icon={<span className="text-2xl">⚡</span>}
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="card-pad">
            <SectionHeading
              title="Risk review queue"
              description={
                pendingFlags === 0
                  ? 'Nothing is above the review threshold.'
                  : `${pendingFlags} item${pendingFlags === 1 ? '' : 's'} GRIE wants a human to look at.`
              }
              action={
                <Link to="/risk" className="btn-secondary btn-sm">
                  Open queue
                </Link>
              }
            />

            {flags.length === 0 ? (
              <div className="rounded-lg bg-emerald-50 px-4 py-6 text-center">
                <p className="text-sm font-medium text-emerald-800">All clear</p>
                <p className="mt-0.5 text-xs text-emerald-700">
                  No ward, contractor or project is currently above the threshold.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {flags.slice(0, 4).map((flag) => (
                  <li key={flag.id}>
                    <Link
                      to="/risk"
                      className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-slate-50"
                    >
                      <RiskBadge band={flag.band} score={flag.score} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {flag.entityLabel}
                        </p>
                        <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                          {flag.reason}
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card-pad">
            <SectionHeading title="Where complaints stand" />
            <StatusBar byStatus={complaints.byStatus} total={complaints.total} />
          </div>
        </div>

        <aside className="space-y-5">
          <div className="card-pad">
            <SectionHeading title="By department" />
            {departmentBreakdown.length === 0 ? (
              <p className="text-sm text-slate-500">No routed complaints yet.</p>
            ) : (
              <ul className="space-y-2.5">
                {departmentBreakdown.map((dept) => (
                  <li key={dept.departmentId}>
                    <div className="flex items-baseline justify-between text-sm">
                      <span className="truncate font-medium text-slate-700">{dept.name}</span>
                      <span className="tnum ml-2 text-slate-500">{dept.count}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand-500"
                        style={{ width: `${(dept.count / maxDept) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="card-pad">
            <SectionHeading title="Jump to" />
            <div className="space-y-1.5">
              {[
                { to: '/wards', label: 'Ward risk map', icon: '🗺️' },
                { to: '/complaints', label: 'All complaints', icon: '📋' },
                { to: '/users', label: 'Manage people', icon: '👥' },
                { to: '/audit', label: 'Audit trail', icon: '🔒' },
              ].map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100"
                >
                  <span aria-hidden>{link.icon}</span>
                  {link.label}
                </Link>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}
