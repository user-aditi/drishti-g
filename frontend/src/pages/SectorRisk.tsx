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
import type { SectorRisk as Row } from '../lib/types'

export default function SectorRisk() {
  const [sectors, setSectors] = useState<Row[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .sectorRisk()
      .then((res) => {
        // Riskiest first: this page exists to answer "where is the problem?"
        const sorted = [...res.items].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
        setSectors(sorted)
        setSelectedId(sorted[0]?.sectorId ?? null)
      })
      .catch(() => setError('Could not load sector risk scores.'))
      .finally(() => setLoading(false))
  }, [])

  const selected = useMemo(
    () => sectors.find((s) => s.sectorId === selectedId) ?? null,
    [sectors, selectedId],
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

  if (sectors.length === 0) {
    return (
      <EmptyState
        icon="📍"
        title="No sectors scored yet"
        description="Run a recompute from the risk queue to generate scores."
      />
    )
  }

  const scored = sectors.filter((s) => s.score != null)
  const cityAverage =
    scored.length > 0 ? scored.reduce((sum, s) => sum + (s.score ?? 0), 0) / scored.length : 0

  return (
    <div>
      <PageHeader
        title="Sector risk"
        description="Every sector scored on missed deadlines, repeat complaints, escalations, open load and speed."
      />

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <div className="card overflow-hidden">
            <div className="flex items-baseline justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-slate-800">All sectors</h2>
              <span className="tnum text-xs text-slate-500">
                authority average {cityAverage.toFixed(0)}
              </span>
            </div>

            <ul className="max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
              {sectors.map((s) => {
                const active = s.sectorId === selectedId
                const meta = s.band ? BAND_META[s.band] : null

                return (
                  <li key={s.sectorId}>
                    <button
                      onClick={() => setSelectedId(s.sectorId)}
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
                        {s.score == null ? '—' : Math.round(s.score)}
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-slate-900">
                          Sector {s.number} — {s.name}
                        </span>
                        <span className="block truncate text-xs text-slate-500">
                          {s.circle} · {s.zone}
                        </span>
                      </span>

                      <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-100 sm:block">
                        <span
                          className={`block h-full rounded-full ${meta?.bar ?? 'bg-slate-300'}`}
                          style={{ width: `${s.score ?? 0}%` }}
                        />
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </div>

        <div className="lg:col-span-3">
          {selected == null || selected.score == null || selected.band == null ? (
            <EmptyState
              icon="📊"
              title="Not scored yet"
              description="This sector has no complaint history to score against."
            />
          ) : (
            <div className="card-pad">
              <div className="mb-5 flex flex-wrap items-center gap-5">
                <RiskDial score={selected.score} band={selected.band} />
                <div className="min-w-0">
                  <h2 className="text-lg font-bold text-slate-900">
                    Sector {selected.number} — {selected.name}
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-500">
                    {selected.circle} · {selected.zone}
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
