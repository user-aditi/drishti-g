'use client'

import { useState } from 'react'
import { Card } from '@/components/ui/card'
import { EmptyState, SectionHeading } from '@/components/shared/page-header'
import { RiskDial, RiskExplanation } from '@/components/shared/risk-explanation'
import { BAND_META } from '@/lib/constants'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { SectorRisk } from '@/types'

/**
 * A ranked list on the left, the selected sector's full reasoning on the right.
 *
 * The ranking answers "where is the problem?" and the panel answers "why?" —
 * which is the only pair of questions this screen exists for.
 */
export function SectorRiskClient({ sectors }: { sectors: SectorRisk[] }) {
    const [selectedId, setSelectedId] = useState<number | null>(sectors[0]?.sectorId ?? null)
    const selected = sectors.find((s) => s.sectorId === selectedId) ?? null

    const scored = sectors.filter((s) => s.score != null)
    const average =
        scored.length > 0 ? scored.reduce((sum, s) => sum + (s.score ?? 0), 0) / scored.length : 0

    return (
        <div className="grid gap-5 lg:grid-cols-5">
            <div className="lg:col-span-2">
                <Card className="overflow-hidden">
                    <div className="flex items-baseline justify-between border-b border-[color:var(--border)] px-4 py-3">
                        <h2 className="text-sm font-semibold">All sectors</h2>
                        <span className="tnum text-xs text-[color:var(--muted-foreground)]">
                            authority average {average.toFixed(0)}
                        </span>
                    </div>

                    <ul className="max-h-[560px] divide-y divide-[color:var(--border)] overflow-y-auto">
                        {sectors.map((s) => {
                            const active = s.sectorId === selectedId
                            const meta = s.band ? BAND_META[s.band] : null

                            return (
                                <li key={s.sectorId}>
                                    <button
                                        onClick={() => setSelectedId(s.sectorId)}
                                        aria-current={active}
                                        className={cn(
                                            'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors',
                                            active
                                                ? 'bg-[color:var(--accent)]'
                                                : 'hover:bg-[color:var(--muted)]',
                                        )}
                                    >
                                        <span
                                            className={cn(
                                                'tnum flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                                                meta ? meta.className : 'bg-slate-100 text-slate-400',
                                            )}
                                        >
                                            {s.score == null ? '—' : Math.round(s.score)}
                                        </span>

                                        <span className="min-w-0 flex-1">
                                            <span className="block truncate text-sm font-medium">
                                                Sector {s.number} — {s.name}
                                            </span>
                                            <span className="block truncate text-xs text-[color:var(--muted-foreground)]">
                                                {s.circle} · {s.zone}
                                            </span>
                                        </span>

                                        <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[color:var(--muted)] sm:block">
                                            <span
                                                className={cn(
                                                    'block h-full rounded-full',
                                                    meta?.bar ?? 'bg-slate-300',
                                                )}
                                                style={{ width: `${s.score ?? 0}%` }}
                                            />
                                        </span>
                                    </button>
                                </li>
                            )
                        })}
                    </ul>
                </Card>
            </div>

            <div className="lg:col-span-3">
                {selected == null || selected.score == null || selected.band == null ? (
                    <EmptyState
                        title="Not scored yet"
                        description="This sector has no complaint history to score against."
                    />
                ) : (
                    <Card className="p-5">
                        <div className="mb-5 flex flex-wrap items-center gap-5">
                            <RiskDial score={selected.score} band={selected.band} />
                            <div className="min-w-0">
                                <h2 className="text-lg font-bold">
                                    Sector {selected.number} — {selected.name}
                                </h2>
                                <p className="mt-0.5 text-sm text-[color:var(--muted-foreground)]">
                                    {selected.circle} · {selected.zone}
                                </p>
                                {selected.computedAt && (
                                    <p className="mt-1 text-xs text-[color:var(--muted-foreground)] opacity-70">
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
                        />
                    </Card>
                )}
            </div>
        </div>
    )
}
