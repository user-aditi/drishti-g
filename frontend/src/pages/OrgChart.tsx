import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import {
  CardSkeleton,
  EmptyState,
  ErrorBanner,
  PageHeader,
  SectionHeading,
} from '../components/ui'
import { RANK_STYLE, initials } from '../lib/format'
import type { Department, OrgChart as Chart } from '../lib/types'

/**
 * Who holds which post, tier by tier.
 *
 * This is the screen that answers "who is responsible for Sector 5 sanitation?"
 * without anyone having to ask around — and it makes a vacancy visible, which
 * is usually the reason a complaint sits unactioned.
 */
export default function OrgChart() {
  const [departments, setDepartments] = useState<Department[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [chart, setChart] = useState<Chart | null>(null)
  const [loading, setLoading] = useState(true)
  const [chartLoading, setChartLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .departments()
      .then((all) => {
        const active = all.filter((d) => d.status === 'ACTIVE')
        setDepartments(active)
        setSelectedId(active[0]?.id ?? null)
      })
      .catch(() => setError('Could not load departments.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (selectedId == null) return
    setChartLoading(true)
    api
      .orgChart(selectedId)
      .then(setChart)
      .catch(() => setError('Could not load the org chart.'))
      .finally(() => setChartLoading(false))
  }, [selectedId])

  if (loading) return <CardSkeleton rows={6} />
  if (error) return <ErrorBanner message={error} />
  if (departments.length === 0) {
    return <EmptyState icon="🏛️" title="No active departments" />
  }

  return (
    <div>
      <PageHeader
        title="Organisation chart"
        description="The chain of command a complaint travels up when it is not resolved in time."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {departments.map((d) => (
          <button
            key={d.id}
            onClick={() => setSelectedId(d.id)}
            className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all ${
              selectedId === d.id
                ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500'
                : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
            }`}
          >
            <span aria-hidden>{d.icon}</span>
            {d.name}
          </button>
        ))}
      </div>

      {chartLoading || !chart ? (
        <CardSkeleton rows={8} />
      ) : (
        <div className="space-y-4">
          <div className="card-pad">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden>
                  {chart.department.icon}
                </span>
                <div>
                  <h2 className="font-semibold text-slate-900">{chart.department.name}</h2>
                  {chart.department.nameHi && (
                    <p className="text-sm text-slate-500">{chart.department.nameHi}</p>
                  )}
                </div>
              </div>
              <span className="tnum text-sm text-slate-500">{chart.totalStaff} staff posted</span>
            </div>
          </div>

          {chart.tiers.map((tier, index) => (
            <div key={tier.rank} className="relative">
              {/* A connector between tiers, so it reads as a chain rather than a list. */}
              {index > 0 && (
                <span className="absolute -top-4 left-8 h-4 w-px bg-slate-300" aria-hidden />
              )}

              <div className="card-pad">
                <SectionHeading
                  title={tier.designation}
                  description={`${tier.count} ${tier.count === 1 ? 'post' : 'posts'} · ${
                    tier.rank === 'FIELD_WORKER'
                      ? 'does the physical work'
                      : tier.rank === 'SECTION_OFFICER'
                        ? 'triages complaints and allots work'
                        : 'oversight and escalation'
                  }`}
                  action={<span className={`pill ${RANK_STYLE[tier.rank]}`}>{tier.label}</span>}
                />

                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {tier.people.slice(0, 12).map((p) => (
                    <div
                      key={p.id}
                      className={`flex items-center gap-2.5 rounded-lg border px-3 py-2 ${
                        p.user.isActive
                          ? 'border-slate-200 bg-white'
                          : 'border-slate-200 bg-slate-50 opacity-60'
                      }`}
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-semibold text-slate-600">
                        {initials(p.user.fullName)}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-900">
                          {p.user.fullName}
                        </p>
                        <p className="truncate text-xs text-slate-500">
                          {p.jurisdictionLabel}
                          {p.employeeCode && ` · ${p.employeeCode}`}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {tier.people.length > 12 && (
                  <p className="mt-3 text-xs text-slate-500">
                    and {tier.people.length - 12} more posted across the authority
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
