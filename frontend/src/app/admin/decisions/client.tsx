'use client'

import { useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Panel } from '@/components/shared/surface'
import { Segmented } from '@/components/shared/controls'
import { DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { formatDateTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DecisionAgreement, DecisionRow } from '@/types'

const KIND_LABEL: Record<string, string> = {
    CATEGORY: 'What it is about',
    ROUTE: 'Who holds it',
    PRIORITY: 'How urgent',
    NEXT_ACTION: 'What happens next',
}

const OUTCOME_META: Record<
    string,
    { label: string; variant: 'default' | 'purple' | 'neutral' | 'success' | 'danger' }
> = {
    PENDING: { label: 'Not reviewed', variant: 'neutral' },
    CONFIRMED: { label: 'Let stand', variant: 'success' },
    OVERRIDDEN: { label: 'Overruled', variant: 'danger' },
    AUTO_EXECUTED: { label: 'Auto', variant: 'purple' },
}

const KIND_FILTERS = [
    { value: '', label: 'Every kind' },
    { value: 'CATEGORY', label: 'Category' },
    { value: 'ROUTE', label: 'Routing' },
    { value: 'PRIORITY', label: 'Priority' },
    { value: 'NEXT_ACTION', label: 'Next action' },
]

const OUTCOME_FILTERS = [
    { value: '', label: 'Any outcome' },
    { value: 'PENDING', label: 'Not reviewed' },
    { value: 'CONFIRMED', label: 'Let stand' },
    { value: 'OVERRIDDEN', label: 'Overruled' },
]

/**
 * Agreement per kind of judgement.
 *
 * The rate is over *reviewed* decisions only, and the unreviewed count sits
 * next to it rather than being folded in. Counting silence as agreement would
 * report the classifier as near-perfect precisely because nobody was checking
 * it, which is the opposite of what this screen is for.
 */
function Agreement({ rows }: { rows: DecisionAgreement[] }) {
    if (rows.length === 0) return null

    return (
        <Panel className="mb-5">
            <h2 className="text-sm font-semibold">How often each judgement survives review</h2>
            <p className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">
                Out of the decisions someone actually looked at. Decisions nobody reviewed are
                counted separately — treating them as agreement would flatter the engine.
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {rows.map((row) => (
                    <div
                        key={row.kind}
                        className="rounded-[var(--radius-lg)] border border-[color:var(--border)] p-3"
                    >
                        <p className="text-[11px] font-medium text-[color:var(--muted-foreground)]">
                            {KIND_LABEL[row.kind] ?? row.kind}
                        </p>
                        <p className="tnum mt-1 text-2xl font-semibold">
                            {row.agreementRate == null
                                ? '—'
                                : `${Math.round(row.agreementRate * 100)}%`}
                        </p>
                        <p className="mt-1 text-[11px] text-[color:var(--muted-foreground)]">
                            {row.agreementRate == null ? (
                                <>none reviewed yet</>
                            ) : (
                                <>
                                    {row.confirmed.toLocaleString()} let stand ·{' '}
                                    {row.overridden.toLocaleString()} overruled
                                </>
                            )}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[color:var(--subtle-foreground)]">
                            {row.pending.toLocaleString()} of {row.total.toLocaleString()} never
                            reviewed
                        </p>
                    </div>
                ))}
            </div>
        </Panel>
    )
}

export function DecisionsClient({
    result,
    kind,
    outcome,
}: {
    result: { items: DecisionRow[]; total: number; page: number; size: number; agreement: DecisionAgreement[] }
    kind: string
    outcome: string
}) {
    const router = useRouter()
    const pathname = usePathname()
    const [pending, startTransition] = useTransition()
    const [openId, setOpenId] = useState<string | number | null>(null)

    function apply(next: { kind?: string; outcome?: string; page?: number }) {
        const params = new URLSearchParams()
        const k = next.kind ?? kind
        const o = next.outcome ?? outcome
        if (k) params.set('kind', k)
        if (o) params.set('outcome', o)
        if (next.page && next.page > 1) params.set('page', String(next.page))
        startTransition(() => router.push(`${pathname}?${params}`))
    }

    const pages = Math.max(1, Math.ceil(result.total / result.size))

    const columns: Column<DecisionRow>[] = [
        {
            key: 'kind',
            header: 'Judgement',
            width: 'w-40',
            value: (d) => d.kind,
            cell: (d) => (
                <span className="text-xs font-medium">{KIND_LABEL[d.kind] ?? d.kind}</span>
            ),
        },
        {
            key: 'complaint',
            header: 'Complaint',
            value: (d) => d.complaint?.referenceNo ?? '',
            cell: (d) =>
                d.complaint ? (
                    <Link href={`/admin/complaints?q=${d.complaint.referenceNo}`}>
                        <RowTitle hint={d.complaint.title}>{d.complaint.referenceNo}</RowTitle>
                    </Link>
                ) : (
                    <span className="text-xs text-[color:var(--subtle-foreground)]">gone</span>
                ),
        },
        {
            key: 'chosen',
            header: 'Chose',
            width: 'w-32',
            value: (d) => d.chosen,
            cell: (d) => <Mono>{d.chosen}</Mono>,
        },
        {
            key: 'confidence',
            header: 'Confidence',
            width: 'w-28',
            align: 'right',
            value: (d) => d.confidence ?? -1,
            cell: (d) => (
                <span
                    className={cn(
                        'tnum text-xs',
                        d.confidence == null && 'text-[color:var(--subtle-foreground)]',
                    )}
                >
                    {d.confidence == null ? '—' : `${Math.round(d.confidence * 100)}%`}
                </span>
            ),
        },
        {
            key: 'outcome',
            header: 'Outcome',
            width: 'w-32',
            value: (d) => d.outcome,
            cell: (d) => {
                const meta = OUTCOME_META[d.outcome] ?? OUTCOME_META.PENDING!
                return <Badge variant={meta.variant}>{meta.label}</Badge>
            },
        },
        {
            key: 'when',
            header: 'When',
            align: 'right',
            value: (d) => new Date(d.createdAt).getTime(),
            cell: (d) => (
                <time
                    className="text-xs text-[color:var(--muted-foreground)]"
                    title={formatDateTime(d.createdAt)}
                    dateTime={d.createdAt}
                >
                    {relativeTime(d.createdAt)}
                </time>
            ),
        },
    ]

    return (
        <div>
            <Agreement rows={result.agreement} />

            <div className="mb-4 flex flex-wrap gap-4">
                <Segmented
                    variant="pill"
                    label="Kind of judgement"
                    value={kind}
                    onChange={(v) => apply({ kind: v })}
                    options={KIND_FILTERS}
                />
                <Segmented
                    variant="pill"
                    label="Outcome"
                    value={outcome}
                    onChange={(v) => apply({ outcome: v })}
                    options={OUTCOME_FILTERS}
                />
            </div>

            <div className={cn('transition-opacity', pending && 'opacity-60')}>
                <DataTable
                    rows={result.items}
                    columns={columns}
                    getRowId={(d) => d.id}
                    initialSort={{ key: 'when', direction: 'desc' }}
                    empty="No decisions match this filter."
                    expansion={{
                        openId,
                        onToggle: setOpenId,
                        label: (d) => `Show what was considered for ${d.kind.toLowerCase()}`,
                        render: (d) => (
                            <div className="space-y-3 text-xs">
                                <div>
                                    <h4 className="mb-1 font-semibold">Why</h4>
                                    <ul className="list-disc space-y-1 pl-4 text-[color:var(--muted-foreground)]">
                                        {(d.reasons ?? []).map((r, i) => (
                                            <li key={i}>{r}</li>
                                        ))}
                                    </ul>
                                </div>

                                <div>
                                    <h4 className="mb-1 font-semibold">What else it weighed</h4>
                                    {(d.alternatives ?? []).length === 0 ? (
                                        <p className="text-[color:var(--muted-foreground)]">
                                            Nothing. This engine picks the first workable answer
                                            rather than ranking candidates, so there were no
                                            runners-up to record.
                                        </p>
                                    ) : (
                                        <ul className="space-y-1">
                                            {d.alternatives.map((a) => (
                                                <li
                                                    key={a.value}
                                                    className={cn(
                                                        'flex justify-between gap-4',
                                                        a.value === d.chosen && 'font-semibold',
                                                    )}
                                                >
                                                    <span>{a.label}</span>
                                                    <span className="tnum text-[color:var(--muted-foreground)]">
                                                        {a.score}
                                                    </span>
                                                </li>
                                            ))}
                                        </ul>
                                    )}
                                </div>

                                {d.outcome === 'OVERRIDDEN' && (
                                    <div>
                                        <h4 className="mb-1 font-semibold">Overruled</h4>
                                        <p className="text-[color:var(--muted-foreground)]">
                                            Changed to <Mono>{d.overriddenTo ?? '—'}</Mono>
                                            {d.overriddenBy ? ` by ${d.overriddenBy.fullName}` : ''}
                                            {d.overrideReason ? `. ${d.overrideReason}` : '.'}
                                        </p>
                                    </div>
                                )}
                            </div>
                        ),
                    }}
                />
            </div>

            {pages > 1 && (
                <div className="mt-4 flex items-center justify-between text-xs text-[color:var(--muted-foreground)]">
                    <span className="tnum">
                        Page {result.page} of {pages} · {result.total.toLocaleString()} decisions
                    </span>
                    <div className="flex gap-2">
                        <button
                            type="button"
                            className="rounded border border-[color:var(--border)] px-2 py-1 disabled:opacity-40"
                            disabled={result.page <= 1}
                            onClick={() => apply({ page: result.page - 1 })}
                        >
                            Previous
                        </button>
                        <button
                            type="button"
                            className="rounded border border-[color:var(--border)] px-2 py-1 disabled:opacity-40"
                            disabled={result.page >= pages}
                            onClick={() => apply({ page: result.page + 1 })}
                        >
                            Next
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}
