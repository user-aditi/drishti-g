'use client'

import { useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { CircleCheck, Download, Loader2, Lock, ShieldAlert } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel } from '@/components/shared/surface'
import { Segmented } from '@/components/shared/controls'
import { DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { formatDate, formatDateTime, humaniseAction, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { AuditEvent, Paged } from '@/types'

type ChainResult = {
    valid: boolean
    checked: number
    head?: string
    brokenAtId?: number
    reason?: string
}

/** Which engine wrote the entry. */
const SOURCE_META: Record<string, { label: string; variant: 'default' | 'purple' | 'neutral' }> = {
    gcce: { label: 'GCCE', variant: 'default' },
    grie: { label: 'GRIE', variant: 'purple' },
    api: { label: 'User', variant: 'neutral' },
    system: { label: 'System', variant: 'neutral' },
}

const FILTERS = [
    { value: '', label: 'Everything' },
    { value: 'complaint', label: 'Complaints' },
    { value: 'risk', label: 'Risk' },
    { value: 'escalation', label: 'Escalations' },
    { value: 'staff', label: 'Postings' },
]

function ChainStatus() {
    const [result, setResult] = useState<ChainResult | null>(null)
    const [verifying, setVerifying] = useState(false)

    async function verify() {
        setVerifying(true)
        try {
            setResult(await apiClient.verifyChain())
        } catch {
            setResult({ valid: false, checked: 0, reason: 'Could not reach the API to verify.' })
        } finally {
            setVerifying(false)
        }
    }

    return (
        <Panel
            tone={result && !result.valid ? 'danger' : undefined}
            className={cn(
                'mb-5 flex flex-wrap items-center justify-between gap-4',
                result && !result.valid && 'bg-[color:var(--error-bg)]',
            )}
        >
            <div className="flex items-start gap-3">
                {result == null ? (
                    <Lock className="mt-0.5 h-6 w-6 shrink-0 text-[color:var(--muted-foreground)]" />
                ) : result.valid ? (
                    <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-[color:var(--success)]" />
                ) : (
                    <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-[color:var(--error)]" />
                )}

                <div>
                    <h2 className="text-sm font-semibold">
                        {result == null
                            ? 'Tamper-evident audit trail'
                            : result.valid
                              ? 'Chain intact'
                              : 'Chain broken'}
                    </h2>
                    <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                        {result == null ? (
                            <>
                                Each entry stores a fingerprint of the entry before it, so editing or
                                deleting any historical record breaks every fingerprint after it.
                            </>
                        ) : result.valid ? (
                            <>
                                All {result.checked} entries verified. No record has been edited or removed
                                since it was written.
                            </>
                        ) : (
                            <span className="text-[color:var(--error-fg)]">
                                {result.reason}
                                {result.brokenAtId != null && ` — first detected at entry #${result.brokenAtId}.`}
                            </span>
                        )}
                    </p>
                    {result?.valid && result.head && (
                        <p className="mt-1.5 font-mono text-[10px] text-[color:var(--subtle-foreground)]">
                            head {result.head.slice(0, 32)}…
                        </p>
                    )}
                </div>
            </div>

            <Button size="sm" variant="outline" onClick={() => void verify()} disabled={verifying}>
                {verifying && <Loader2 className="animate-spin" />}
                {verifying ? 'Verifying…' : 'Verify chain'}
            </Button>
        </Panel>
    )
}

type EventLogSummary = { events: number; cases: number; from: string | null; to: string | null }

/**
 * Take the complaint lifecycle out as process-mining data.
 *
 * The system has been keeping an event log since the first build — every status
 * transition, with the officer and the timestamp — without ever calling it one
 * or letting anyone take it out. This does both. The counts sit beside the
 * button rather than behind it, because "how much is actually in there" is the
 * first thing anyone asks and the honest answer on a young system might be
 * "not much yet".
 */
function EventLogExport() {
    const [summary, setSummary] = useState<EventLogSummary | null>(null)
    const [downloading, setDownloading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        let live = true
        apiClient
            .eventLogSummary()
            .then((s) => live && setSummary(s))
            .catch(() => live && setSummary(null))
        return () => {
            live = false
        }
    }, [])

    async function download() {
        setDownloading(true)
        setError(null)
        try {
            const { blob, filename } = await apiClient.downloadEventLog()
            const url = URL.createObjectURL(blob)
            const anchor = document.createElement('a')
            anchor.href = url
            anchor.download = filename
            anchor.click()
            // Revoking immediately can cancel the save in some browsers.
            setTimeout(() => URL.revokeObjectURL(url), 10_000)
        } catch {
            setError('The export failed. You need Super Admin access for the event log.')
        } finally {
            setDownloading(false)
        }
    }

    const empty = summary != null && summary.events === 0

    return (
        <Panel className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-start gap-3">
                <Download className="mt-0.5 h-6 w-6 shrink-0 text-[color:var(--muted-foreground)]" />
                <div>
                    <h2 className="text-sm font-semibold">Event log</h2>
                    <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                        Every status transition as one row — case, activity, officer, timestamp — in a
                        CSV that opens in pm4py without editing.
                    </p>
                    <p className="mt-1.5 font-mono text-[10px] text-[color:var(--subtle-foreground)]">
                        {summary == null ? (
                            'counting…'
                        ) : empty ? (
                            'no transitions recorded yet'
                        ) : (
                            <>
                                {summary.events.toLocaleString()} events · {summary.cases.toLocaleString()}{' '}
                                cases · {formatDate(summary.from)} – {formatDate(summary.to)}
                            </>
                        )}
                    </p>
                    {error && <p className="mt-1.5 text-[10px] text-[color:var(--error-fg)]">{error}</p>}
                </div>
            </div>

            <Button
                size="sm"
                variant="outline"
                onClick={() => void download()}
                disabled={downloading || empty}
            >
                {downloading && <Loader2 className="animate-spin" />}
                {downloading ? 'Preparing…' : 'Download CSV'}
            </Button>
        </Panel>
    )
}

/**
 * The audit trail, as a ledger.
 *
 * This is the most tabular data in the product — a fixed set of fields written
 * once per event, never edited — and it was rendered as a list of prose blocks.
 * As a table it reads the way a ledger reads: down the time column, with the
 * writing engine and the actor as columns you can scan for anomalies. The
 * record itself, hash and all, opens under its own row.
 */
export function AuditTrailClient({
    result,
    filter,
}: {
    result: Paged<AuditEvent>
    filter: string
}) {
    const router = useRouter()
    const pathname = usePathname()
    const [pending, startTransition] = useTransition()
    const [openId, setOpenId] = useState<string | number | null>(null)

    function apply(nextFilter: string, page = 1) {
        const params = new URLSearchParams()
        if (nextFilter) params.set('action', nextFilter)
        if (page > 1) params.set('page', String(page))
        startTransition(() => router.push(`${pathname}?${params}`))
    }

    const pages = Math.max(1, Math.ceil(result.total / result.size))

    const columns: Column<AuditEvent>[] = [
        {
            key: 'source',
            header: 'Written by',
            width: 'w-28',
            value: (e) => e.source,
            cell: (e) => {
                const source = SOURCE_META[e.source] ?? SOURCE_META.api!
                return <Badge variant={source.variant}>{source.label}</Badge>
            },
        },
        {
            key: 'action',
            header: 'Event',
            value: (e) => `${humaniseAction(e.action)} ${e.entityType} ${e.entityId}`,
            cell: (e) => (
                <RowTitle hint={`${e.entityType} #${e.entityId}`}>{humaniseAction(e.action)}</RowTitle>
            ),
        },
        {
            key: 'actor',
            header: 'Actor',
            value: (e) => e.actorLabel ?? 'Automated',
            cell: (e) => (
                <span className={cn('text-xs', !e.actorLabel && 'text-[color:var(--subtle-foreground)]')}>
                    {e.actorLabel ?? 'Automated'}
                </span>
            ),
        },
        {
            key: 'when',
            header: 'When',
            align: 'right',
            value: (e) => new Date(e.createdAt).getTime(),
            cell: (e) => (
                <time
                    className="text-xs text-[color:var(--muted-foreground)]"
                    title={formatDateTime(e.createdAt)}
                    dateTime={e.createdAt}
                >
                    {relativeTime(e.createdAt)}
                </time>
            ),
        },
    ]

    return (
        <div>
            <ChainStatus />
            <EventLogExport />

            <Segmented
                variant="pill"
                label="Filter the trail"
                className="mb-4"
                value={filter}
                onChange={apply}
                options={FILTERS}
            />

            <div className={cn('transition-opacity', pending && 'opacity-60')}>
                <DataTable
                    rows={result.items}
                    columns={columns}
                    getRowId={(e) => e.id}
                    initialSort={{ key: 'when', direction: 'desc' }}
                    empty="No entries match this filter."
                    hideCount
                    expansion={{
                        openId,
                        onToggle: setOpenId,
                        label: (e) => `Show the record written for ${humaniseAction(e.action)}`,
                        render: (e) => (
                            <div className="space-y-3">
                                <pre className="overflow-x-auto rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--card)] p-3 font-mono text-[11px] leading-relaxed">
                                    {JSON.stringify(e.payload, null, 2)}
                                </pre>
                                <dl className="grid gap-1 text-[10px]">
                                    <div className="flex gap-2">
                                        <dt className="w-10 shrink-0 label-cap">hash</dt>
                                        <dd className="min-w-0 truncate">
                                            <Mono>{e.hash}</Mono>
                                        </dd>
                                    </div>
                                    <div className="flex gap-2">
                                        <dt className="w-10 shrink-0 label-cap">prev</dt>
                                        <dd className="min-w-0 truncate">
                                            <Mono>{e.prevHash ?? '—'}</Mono>
                                        </dd>
                                    </div>
                                </dl>
                            </div>
                        ),
                    }}
                />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                <p className="tnum text-sm text-[color:var(--muted-foreground)]">
                    {result.total} entries · page {result.page} of {pages}
                </p>
                <div className="flex gap-2">
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={result.page <= 1}
                        onClick={() => apply(filter, result.page - 1)}
                    >
                        Previous
                    </Button>
                    <Button
                        size="sm"
                        variant="outline"
                        disabled={result.page >= pages}
                        onClick={() => apply(filter, result.page + 1)}
                    >
                        Next
                    </Button>
                </div>
            </div>
        </div>
    )
}
