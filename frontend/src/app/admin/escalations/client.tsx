'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowUp, FileText, Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/shared/surface'
import { Toolbar } from '@/components/shared/controls'
import { DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { ErrorBanner } from '@/components/shared/page-header'
import { PriorityBadge, StatusBadge } from '@/components/shared/status-badge'
import { relativeTime } from '@/lib/format'
import type { EscalationInboxItem } from '@/types'

/**
 * What has climbed to this officer because a deadline was missed below them.
 *
 * A register rather than a stack of cards: an escalation inbox is triaged by
 * comparing rows — which is oldest, which is still unacknowledged, which sector
 * keeps appearing — and cards make every one of those comparisons a scroll.
 * The reason it climbed is the one thing that does not fit a column, so it
 * lives in the row's expansion, one click from the row it belongs to.
 */
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
    const [search, setSearch] = useState('')
    const [openId, setOpenId] = useState<string | number | null>(null)
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

    const columns: Column<EscalationInboxItem>[] = [
        {
            key: 'ref',
            header: 'Reference',
            width: 'w-36',
            value: (e) => e.complaint.referenceNo,
            cell: (e) => <Mono>{e.complaint.referenceNo}</Mono>,
        },
        {
            key: 'title',
            header: 'Complaint',
            value: (e) => `${e.complaint.title} ${e.reason}`,
            cell: (e) => (
                <div className="flex items-center gap-2">
                    {e.complaint.category?.icon ? (
                        <span aria-hidden>{e.complaint.category.icon}</span>
                    ) : (
                        <ArrowUp className="h-4 w-4 text-[color:var(--escalate)]" aria-hidden />
                    )}
                    <RowTitle
                        hint={[
                            e.complaint.sector && `Sector ${e.complaint.sector.number}`,
                            e.complaint.department?.name,
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    >
                        {e.complaint.title}
                    </RowTitle>
                </div>
            ),
        },
        {
            key: 'from',
            header: 'Climbed from',
            secondary: true,
            value: (e) => e.fromLabel ?? null,
            cell: (e) => <span className="text-xs">{e.fromLabel ?? 'below'}</span>,
        },
        {
            key: 'status',
            header: 'Status',
            value: (e) => e.complaint.status,
            cell: (e) => <StatusBadge status={e.complaint.status} />,
        },
        {
            key: 'priority',
            header: 'Priority',
            secondary: true,
            value: (e) => e.complaint.priority,
            cell: (e) => <PriorityBadge priority={e.complaint.priority} />,
        },
        {
            key: 'when',
            header: 'Escalated',
            align: 'right',
            value: (e) => new Date(e.createdAt).getTime(),
            cell: (e) => (
                <span className="text-xs text-[color:var(--muted-foreground)]">
                    {relativeTime(e.createdAt)}
                </span>
            ),
        },
        {
            key: 'ack',
            header: 'Acknowledged',
            align: 'right',
            width: 'w-40',
            value: (e) => (e.acknowledgedAt ? new Date(e.acknowledgedAt).getTime() : null),
            cell: (e) =>
                e.acknowledgedAt ? (
                    <Badge variant="success">{relativeTime(e.acknowledgedAt)}</Badge>
                ) : (
                    <Button
                        size="sm"
                        onClick={(event) => {
                            event.stopPropagation()
                            void acknowledge(e.id)
                        }}
                        disabled={busyId === e.id}
                    >
                        {busyId === e.id && <Loader2 className="animate-spin" />}
                        Acknowledge
                    </Button>
                ),
        },
    ]

    return (
        <div>
            {error && <ErrorBanner message={error} />}

            {pending.length > 0 && (
                <Callout
                    tone="escalate"
                    icon={<ArrowUp className="h-4 w-4" aria-hidden />}
                    className="mb-4"
                    title={`${pending.length} escalation${pending.length === 1 ? '' : 's'} still unacknowledged`}
                >
                    Acknowledging records that you have seen it. It stays on your desk either way
                    until the complaint underneath is settled.
                </Callout>
            )}

            <Toolbar
                search={search}
                onSearch={setSearch}
                placeholder="Search these escalations"
                actions={
                    canSweep && (
                        <Button variant="outline" onClick={() => void sweep()} disabled={sweeping}>
                            {sweeping && <Loader2 className="animate-spin" />}
                            Run escalation sweep
                        </Button>
                    )
                }
            />

            <DataTable
                rows={items}
                columns={columns}
                getRowId={(e) => e.id}
                search={search}
                initialSort={{ key: 'when', direction: 'desc' }}
                rowTone={(e) => (e.acknowledgedAt == null ? 'warning' : 'muted')}
                empty="Nothing has been escalated to you."
                footnote="Amber rows have not been acknowledged yet."
                expansion={{
                    openId,
                    onToggle: setOpenId,
                    label: (e) => `Why ${e.complaint.referenceNo} was escalated`,
                    render: (e) => (
                        <div className="space-y-3">
                            <Callout
                                tone="escalate"
                                title={`From ${e.fromLabel ?? 'below'}`}
                                icon={<ArrowUp className="h-4 w-4" aria-hidden />}
                            >
                                {e.reason}
                            </Callout>
                            <Button asChild size="sm" variant="outline">
                                <Link href={`/complaints/${e.complaint.id}`}>
                                    <FileText />
                                    Open the case file
                                </Link>
                            </Button>
                        </div>
                    ),
                }}
            />
        </div>
    )
}
