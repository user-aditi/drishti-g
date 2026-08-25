import { useEffect, useMemo, useState } from 'react'
import { api } from '../lib/api'
import { RiskExplanation } from '../components/RiskExplanation'
import {
  CardSkeleton,
  EmptyState,
  ErrorBanner,
  PageHeader,
  RiskDial,
  SectionHeading,
} from '../components/ui'
import { BAND_META, relativeTime } from '../lib/format'
import type { WardRisk as Ward } from '../lib/types'

export default function WardRisk() {
  const [wards, setWards] = useState<Ward[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .wardRisk()
      .then((res) => {
        // Riskiest first: this page exists to answer "where is the problem?"
        const sorted = [...res.items].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
        setWards(sorted)
        setSelectedId(sorted[0]?.wardId ?? null)
      })
      .catch(() => setError('Could not load ward risk scores.'))
      .finally(() => setLoading(false))
  }, [])

  const selected = useMemo(
    () => wards.find((w) => w.wardId === selectedId) ?? null,
    [wards, selectedId],
  )

  if (loading) {
    return (
      <div className="space-y-4">
        <CardSkeleton rows={2} />
        <CardSkeleton rows={5} />
      </div>
    )
  }

  if (error) return <ErrorBanner message={error} />

  if (wards.length === 0) {
    return (
      <EmptyState
        icon="🗺️"
        title="No wards scored yet"
        description="Run a recompute from the risk queue to generate scores."
      />
    )
  }

  const scored = wards.filter((w) => w.score != null)
  const cityAverage =
    scored.length > 0 ? scored.reduce((sum, w) => sum + (w.score ?? 0), 0) / scored.length : 0

  return (
    <div>
      <PageHeader
        title="Ward risk"
        description="Every ward scored on repeat complaints, missed deadlines, open load and resolution speed."
      />

      <div className="grid gap-5 lg:grid-cols-5">
        {/* Left: the ranking. */}
        <div className="lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-800">All wards</h2>
              <span className="tnum text-xs text-slate-500">
                city average {cityAverage.toFixed(0)}
              </span>
            </div>

            <ul className="divide-y divide-slate-100">
              {wards.map((ward) => {
                const active = ward.wardId === selectedId
                const meta = ward.band ? BAND_META[ward.band] : null

                return (
                  <li key={ward.wardId}>
                    <button
                      onClick={() => setSelectedId(ward.wardId)}
                      aria-current={active}
                      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
                        active ? 'bg-brand-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <span
                        className={`tnum flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${
                          meta ? meta.className : 'bg-slate-100 text-slate-400'
                        }`}
                      >
                        {ward.score == null ? '—' : Math.round(ward.score)}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          Ward {ward.wardNumber} — {ward.name}
                        </span>
                        <span className="block text-xs text-slate-500">
                          {ward.zone ?? 'Zone not set'}
                          {meta && ` · ${meta.label} risk`}
                        </span>
                      </span>

                      {/* Score as a mini bar, so the ranking reads at a glance. */}
                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 sm:block">
                        <span
                          className={`block h-full rounded-full ${meta?.bar ?? 'bg-slate-300'}`}
                          style={{ width: `${ward.score ?? 0}%` }}
                        />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        {/* Right: the explanation for whichever ward is selected. */}
        <div className="lg:col-span-3">
          {selected == null || selected.score == null || selected.band == null ? (
            <EmptyState
              icon="📊"
              title="Not scored yet"
              description="This ward has no complaint history to score against."
            />
          ) : (
            <div className="card-pad">
              <div className="mb-5 flex flex-wrap items-center gap-5">
                <RiskDial score={selected.score} band={selected.band} />
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-slate-900">
                    Ward {selected.wardNumber} — {selected.name}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {selected.zone ?? 'Zone not set'}
                  </p>
                  {selected.computedAt && (
                    <p className="mt-1 text-xs text-slate-400">
                      Scored {relativeTime(selected.computedAt)}
                    </p>
                  )}
                </div>
              </div>

              <SectionHeading title="Why this score" />
              <RiskExplanation
                factors={selected.factors}
                score={selected.score}
                band={selected.band}
                compact
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
