'use client'

import { useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { CircleCheck, Loader2, Lock, SearchX, ShieldAlert } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { EmptyState } from '@/components/shared/page-header'
import { formatDateTime, humaniseAction, relativeTime } from '@/lib/format'
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

const FILTERS: { key: string; label: string }[] = [
    { key: '', label: 'Everything' },
    { key: 'complaint', label: 'Complaints' },
    { key: 'risk', label: 'Risk' },
    { key: 'escalation', label: 'Escalations' },
    { key: 'staff', label: 'Postings' },
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
        <Card
            className={cn(
                'mb-5 flex flex-wrap items-center justify-between gap-4 p-5',
                result && !result.valid && 'border-red-300 bg-red-50',
            )}
        >
            <div className="flex items-start gap-3">
                {result == null ? (
                    <Lock className="mt-0.5 h-6 w-6 shrink-0 text-[color:var(--muted-foreground)]" />
                ) : result.valid ? (
                    <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
                ) : (
                    <ShieldAlert className="mt-0.5 h-6 w-6 shrink-0 text-red-600" />
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
                            <span className="text-red-700">
                                {result.reason}
                                {result.brokenAtId != null && ` — first detected at entry #${result.brokenAtId}.`}
                            </span>
                        )}
                    </p>
                    {result?.valid && result.head && (
                        <p className="mt-1.5 font-mono text-[10px] text-[color:var(--muted-foreground)] opacity-70">
                            head {result.head.slice(0, 32)}…
                        </p>
                    )}
                </div>
            </div>

            <Button size="sm" variant="outline" onClick={() => void verify()} disabled={verifying}>
                {verifying && <Loader2 className="animate-spin" />}
                {verifying ? 'Verifying…' : 'Verify chain'}
            </Button>
        </Card>
    )
}

function EventRow({ event }: { event: AuditEvent }) {
    const [open, setOpen] = useState(false)
    const source = SOURCE_META[event.source] ?? SOURCE_META.api!

    return (
        <li className="px-4 py-3 transition-colors hover:bg-[color:var(--muted)]">
            <div className="flex items-start gap-3">
                <Badge variant={source.variant} className="shrink-0">
                    {source.label}
                </Badge>

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <span className="text-sm font-medium">
                            {humaniseAction(event.action)}
                            <span className="ml-1.5 font-normal text-[color:var(--muted-foreground)]">
                                {event.entityType} #{event.entityId}
                            </span>
                        </span>
                        <time
                            className="text-xs text-[color:var(--muted-foreground)]"
                            title={formatDateTime(event.createdAt)}
                        >
                            {relativeTime(event.createdAt)}
                        </time>
                    </div>

                    <p className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">
                        {event.actorLabel ?? 'Automated'}
                    </p>

                    <button
                        onClick={() => setOpen((v) => !v)}
                        aria-expanded={open}
                        className="mt-1.5 text-xs font-medium text-[color:var(--primary)] hover:underline"
                    >
                        {open ? 'Hide record' : 'Show record'}
                    </button>

                    {open && (
                        <div className="mt-2 space-y-2">
                            <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                                {JSON.stringify(event.payload, null, 2)}
                            </pre>
                            <dl className="grid gap-1 font-mono text-[10px] text-[color:var(--muted-foreground)]">
                                <div className="flex gap-2">
                                    <dt className="shrink-0">hash</dt>
                                    <dd className="truncate">{event.hash}</dd>
                                </div>
                                <div className="flex gap-2">
                                    <dt className="shrink-0">prev</dt>
                                    <dd className="truncate">{event.prevHash ?? '—'}</dd>
                                </div>
                            </dl>
                        </div>
                    )}
                </div>
            </div>
        </li>
    )
}

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

    function apply(nextFilter: string, page = 1) {
        const params = new URLSearchParams()
        if (nextFilter) params.set('action', nextFilter)
        if (page > 1) params.set('page', String(page))
        startTransition(() => router.push(`${pathname}?${params}`))
    }

    const pages = Math.max(1, Math.ceil(result.total / result.size))

    return (
        <div>
            <ChainStatus />

            <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-1">
                {FILTERS.map(({ key, label }) => (
                    <button
                        key={key || 'all'}
                        onClick={() => apply(key)}
                        className={cn(
                            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                            filter === key
                                ? 'bg-[color:var(--primary)] text-white'
                                : 'text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]',
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {result.items.length === 0 ? (
                <EmptyState icon={<SearchX className="h-10 w-10" />} title="No matching entries" />
            ) : (
                <>
                    <Card className={cn('overflow-hidden transition-opacity', pending && 'opacity-60')}>
                        <ul className="divide-y divide-[color:var(--border)]">
                            {result.items.map((event) => (
                                <EventRow key={event.id} event={event} />
                            ))}
                        </ul>
                    </Card>

                    <div className="mt-4 flex items-center justify-between">
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
                </>
            )}
        </div>
    )
}
