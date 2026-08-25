import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import {
  CardSkeleton,
  ErrorBanner,
  PageHeader,
  RiskBadge,
  SectionHeading,
  StatTile,
} from '../components/ui'
import { STATUS_META, isAuthorityWide, isSeniorOfficer } from '../lib/format'
import type { ComplaintStatus, OversightStats, RiskFlag, SectorPerformance } from '../lib/types'

/** Status order for the funnel — submission through to closure. */
const FUNNEL: ComplaintStatus[] = [
  'SUBMITTED',
  'ROUTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'AWAITING_VERIFICATION',
  'RESOLVED',
  'CLOSED',
]

function StatusBar({
  byStatus,
  total,
}: {
  byStatus: Record<ComplaintStatus, number>
  total: number
}) {
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

/**
 * Oversight for Circle Officer and above.
 *
 * The same page serves every senior rank — the backend scopes the numbers to
 * whatever the caller's postings actually cover, so an Executive Engineer sees
 * their circle and the CEO sees the authority without a separate screen.
 */
export default function Oversight() {
  const { user } = useAuth()
  const [stats, setStats] = useState<OversightStats | null>(null)
  const [flags, setFlags] = useState<RiskFlag[]>([])
  const [sectors, setSectors] = useState<SectorPerformance[]>([])
  const [escalations, setEscalations] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [s, queue, perf, inbox] = await Promise.all([
        api.oversightStats(),
        api.riskQueue().catch(() => ({ items: [] as RiskFlag[] })),
        api.sectorPerformance().catch(() => ({ items: [] as SectorPerformance[] })),
        api.escalationInbox().catch(() => ({ total: 0 })),
      ])
      setStats(s)
      setFlags(queue.items)
      setSectors(perf.items)
      setEscalations(inbox.total)
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

  const { complaints, people, departmentBreakdown, avgResolutionDays, viewer } = stats
  const maxDept = Math.max(...departmentBreakdown.map((d) => d.count), 1)
  const worstSectors = sectors.slice(0, 5)

  return (
    <div>
      <PageHeader
        title="Overview"
        description={`${viewer.designationTitle ?? viewer.rankLabel} · ${viewer.scopeLabel}`}
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Complaints"
          value={complaints.total}
          hint={`${people.citizens} registered citizens`}
          icon={<span className="text-2xl">📋</span>}
        />
        <StatTile
          label="Currently open"
          value={complaints.open}
          tone={complaints.open > 0 ? 'warning' : 'default'}
          hint={`${people.officers} officers · ${people.workers} workers`}
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

      {(escalations > 0 || complaints.awaitingVerification > 0) && (
        <div className="mb-6 grid gap-3 sm:grid-cols-2">
          {escalations > 0 && (
            <Link
              to="/escalations"
              className="card flex items-center gap-4 p-4 transition-all hover:border-purple-300 hover:shadow-lift"
            >
              <span className="text-2xl" aria-hidden>
                ⬆️
              </span>
              <div>
                <p className="tnum text-lg font-bold text-purple-800">{escalations}</p>
                <p className="text-sm text-slate-600">
                  escalated to you because a deadline was missed below
                </p>
              </div>
            </Link>
          )}
          {complaints.awaitingVerification > 0 && (
            <div className="card flex items-center gap-4 p-4">
              <span className="text-2xl" aria-hidden>
                🔍
              </span>
              <div>
                <p className="tnum text-lg font-bold text-violet-800">
                  {complaints.awaitingVerification}
                </p>
                <p className="text-sm text-slate-600">
                  jobs reported done, waiting on a Section Officer to inspect
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="card-pad">
            <SectionHeading
              title="Risk review queue"
              description={
                stats.pendingFlags === 0
                  ? 'Nothing is above the review threshold.'
                  : `${stats.pendingFlags} item${stats.pendingFlags === 1 ? '' : 's'} GRIE wants a human to look at.`
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
                  Nothing is currently above the threshold.
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

          {worstSectors.length > 0 && (
            <div className="card-pad">
              <SectionHeading
                title="Sectors needing attention"
                description="Ordered by how much work is past its deadline."
                action={
                  <Link to="/sectors" className="btn-secondary btn-sm">
                    All sectors
                  </Link>
                }
              />
              <div className="overflow-x-auto">
                <table className="w-full min-w-[420px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs text-slate-500">
                      <th className="pb-2 pr-3 font-medium">Sector</th>
                      <th className="pb-2 pr-3 text-right font-medium">Open</th>
                      <th className="pb-2 pr-3 text-right font-medium">Overdue</th>
                      <th className="pb-2 text-right font-medium">Escalated</th>
                    </tr>
                  </thead>
                  <tbody className="tnum divide-y divide-slate-100">
                    {worstSectors.map((s) => (
                      <tr key={s.sectorId}>
                        <td className="py-2 pr-3">
                          <span className="font-medium text-slate-800">Sector {s.number}</span>
                          <span className="ml-1.5 text-xs text-slate-500">{s.circle}</span>
                        </td>
                        <td className="py-2 pr-3 text-right text-slate-700">{s.open}</td>
                        <td
                          className={`py-2 pr-3 text-right font-semibold ${
                            s.overdue > 0 ? 'text-red-600' : 'text-slate-400'
                          }`}
                        >
                          {s.overdue}
                        </td>
                        <td
                          className={`py-2 text-right ${
                            s.escalated > 0 ? 'font-semibold text-purple-700' : 'text-slate-400'
                          }`}
                        >
                          {s.escalated}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
                      <span className="truncate font-medium text-slate-700">
                        <span aria-hidden>{dept.icon}</span> {dept.name}
                      </span>
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
                { to: '/map', label: 'Map', icon: '🗺️', show: true },
                { to: '/sectors', label: 'Sector risk', icon: '📍', show: true },
                { to: '/complaints', label: 'All complaints', icon: '📋', show: true },
                {
                  to: '/org',
                  label: 'Org chart',
                  icon: '🏛️',
                  show: isSeniorOfficer(user?.rank ?? 'CITIZEN'),
                },
                {
                  to: '/people',
                  label: 'Manage people',
                  icon: '👥',
                  show: isAuthorityWide(user?.rank ?? 'CITIZEN'),
                },
                {
                  to: '/audit',
                  label: 'Audit trail',
                  icon: '🔒',
                  show: isAuthorityWide(user?.rank ?? 'CITIZEN'),
                },
              ]
                .filter((l) => l.show)
                .map((link) => (
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
