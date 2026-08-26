'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUp, FileText, Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { ErrorBanner } from '@/components/shared/page-header'
import { PriorityBadge, StatusBadge } from '@/components/shared/status-badge'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { EscalationInboxItem } from '@/types'

export function EscalationsClient({
    items,
    canSweep,
}: {
    items: EscalationInboxItem[]
    canSweep: boolean
}) {
    const router = useRouter()
    const [busyId, setBusyId] = useState<number | null>(null)
    const [sweeping, setSweeping] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const pending = items.filter((i) => i.acknowledgedAt == null)

    async function acknowledge(id: number) {
        setBusyId(id)
        setError(null)
        try {
            await apiClient.acknowledgeEscalation(id)
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not acknowledge that.'))
        } finally {
            setBusyId(null)
        }
    }

    async function sweep() {
        setSweeping(true)
        setError(null)
        try {
            await apiClient.runEscalationSweep()
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not run the sweep.'))
        } finally {
            setSweeping(false)
        }
    }

    return (
        <div>
            {error && <ErrorBanner message={error} />}

            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                {pending.length > 0 ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
                        <strong className="tnum">{pending.length}</strong> escalation
                        {pending.length === 1 ? '' : 's'} still unacknowledged.
                    </div>
                ) : (
                    <span />
                )}

                {canSweep && (
                    <Button variant="outline" onClick={() => void sweep()} disabled={sweeping}>
                        {sweeping && <Loader2 className="animate-spin" />}
                        Run escalation sweep
                    </Button>
                )}
            </div>

            <div className="space-y-3">
                {items.map((e) => (
                    <Card
                        key={e.id}
                        className={cn(
                            'p-4',
                            e.acknowledgedAt == null ? 'border-l-4 border-l-purple-500' : 'opacity-70',
                        )}
                    >
                        <div className="flex items-start gap-3">
                            <div
                                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-purple-50 text-lg"
                                aria-hidden
                            >
                                {e.complaint.category?.icon ?? <ArrowUp className="h-5 w-5 text-purple-600" />}
                            </div>

                            <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                    <h3 className="min-w-0 flex-1 font-medium">{e.complaint.title}</h3>
                                    <div className="flex shrink-0 gap-1.5">
                                        <StatusBadge status={e.complaint.status} />
                                        {e.complaint.priority !== 'MEDIUM' && (
                                            <PriorityBadge priority={e.complaint.priority} />
                                        )}
                                    </div>
                                </div>

                                <p className="mt-1.5 rounded-lg bg-purple-50 px-3 py-2 text-sm text-purple-900">
                                    <span className="font-medium">From {e.fromRankLabel}:</span> {e.reason}
                                </p>

                                <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--muted-foreground)]">
                                    <span className="font-mono text-[11px] opacity-70">
                                        {e.complaint.referenceNo}
                                    </span>
                                    {e.complaint.sector && <span>Sector {e.complaint.sector.number}</span>}
                                    {e.complaint.department && <span>{e.complaint.department.name}</span>}
                                    <span>escalated {relativeTime(e.createdAt)}</span>
                                </div>

                                <div className="mt-3 flex flex-wrap gap-2">
                                    {e.acknowledgedAt == null ? (
                                        <Button
                                            size="sm"
                                            onClick={() => void acknowledge(e.id)}
                                            disabled={busyId === e.id}
                                        >
                                            {busyId === e.id && <Loader2 className="animate-spin" />}
                                            Acknowledge
                                        </Button>
                                    ) : (
                                        <Badge variant="success">
                                            Acknowledged {relativeTime(e.acknowledgedAt)}
                                        </Badge>
                                    )}
                                    <Button asChild size="sm" variant="outline">
                                        <Link href={`/complaints/${e.complaint.id}`}>
                                            <FileText />
                                            Case file
                                        </Link>
                                    </Button>
                                </div>
                            </div>
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    )
}
