'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { SectionHeading } from '@/components/shared/page-header'
import { RANK_STYLE } from '@/lib/constants'
import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Department, OrgChart, Rank } from '@/types'

/** What each tier of the chain is actually for. */
const TIER_PURPOSE: Partial<Record<Rank, string>> = {
    FIELD_WORKER: 'does the physical work',
    SECTION_OFFICER: 'triages complaints and allots work',
    CIRCLE_OFFICER: 'oversight and escalation',
    ZONAL_OFFICER: 'oversight and escalation',
    HOD: 'runs the department',
}

export function OrgChartClient({
    departments,
    selectedId,
    chart,
}: {
    departments: Department[]
    selectedId: number
    chart: OrgChart | null
}) {
    const router = useRouter()
    const pathname = usePathname()
    const [pending, startTransition] = useTransition()

    function select(id: number) {
        startTransition(() => router.push(`${pathname}?dept=${id}`))
    }

    return (
        <div>
            <div className="mb-5 flex flex-wrap gap-2">
                {departments.map((d) => (
                    <button
                        key={d.id}
                        onClick={() => select(d.id)}
                        className={cn(
                            'flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-all',
                            selectedId === d.id
                                ? 'border-[color:var(--primary)] bg-[color:var(--accent)] text-[color:var(--accent-foreground)] ring-1 ring-[color:var(--primary)]'
                                : 'border-[color:var(--border)] bg-[color:var(--card)] hover:border-[color:var(--input)]',
                        )}
                    >
                        <span aria-hidden>{d.icon}</span>
                        {d.name}
                    </button>
                ))}
            </div>

            {!chart ? (
                <p className="text-sm text-[color:var(--muted-foreground)]">
                    Could not load this department&apos;s chart.
                </p>
            ) : (
                <div className={cn('space-y-4 transition-opacity', pending && 'opacity-60')}>
                    <Card className="p-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <span className="text-2xl" aria-hidden>
                                    {chart.department.icon}
                                </span>
                                <div>
                                    <h2 className="font-semibold">{chart.department.name}</h2>
                                    {chart.department.nameHi && (
                                        <p className="text-sm text-[color:var(--muted-foreground)]">
                                            {chart.department.nameHi}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <span className="tnum text-sm text-[color:var(--muted-foreground)]">
                                {chart.totalStaff} staff posted
                            </span>
                        </div>
                    </Card>

                    {chart.tiers.map((tier, index) => (
                        <div key={tier.rank} className="relative">
                            {/* A connector between tiers, so it reads as a chain rather than a list. */}
                            {index > 0 && (
                                <span
                                    className="absolute -top-4 left-8 h-4 w-px bg-[color:var(--input)]"
                                    aria-hidden
                                />
                            )}

                            <Card className="p-5">
                                <SectionHeading
                                    title={tier.designation}
                                    description={`${tier.count} ${tier.count === 1 ? 'post' : 'posts'} · ${
                                        TIER_PURPOSE[tier.rank] ?? 'oversight'
                                    }`}
                                    action={<Badge className={RANK_STYLE[tier.rank]}>{tier.label}</Badge>}
                                />

                                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                                    {tier.people.slice(0, 12).map((p) => (
                                        <div
                                            key={p.id}
                                            className={cn(
                                                'flex items-center gap-2.5 rounded-lg border px-3 py-2',
                                                p.user.isActive
                                                    ? 'border-[color:var(--border)]'
                                                    : 'border-[color:var(--border)] bg-[color:var(--muted)] opacity-60',
                                            )}
                                        >
                                            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--muted)] text-[11px] font-semibold">
                                                {initials(p.user.fullName)}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="truncate text-sm font-medium">{p.user.fullName}</p>
                                                <p className="truncate text-xs text-[color:var(--muted-foreground)]">
                                                    {p.jurisdictionLabel}
                                                    {p.employeeCode && ` · ${p.employeeCode}`}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>

                                {tier.people.length > 12 && (
                                    <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">
                                        and {tier.people.length - 12} more posted across the authority
                                    </p>
                                )}
                            </Card>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}
