'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleCheck, FileText, Loader2, PartyPopper, QrCode, Users } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Callout } from '@/components/shared/surface'
import { Toolbar } from '@/components/shared/controls'
import { DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { EmptyState, ErrorBanner } from '@/components/shared/page-header'
import { EscalationBadge, PriorityBadge, StatusBadge } from '@/components/shared/status-badge'
import { DEADLINE_TONE, deadlineLabel, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { DeskItem } from '@/types'
import { IssueWorkOrder } from '@/components/officer/issue-work-order'
import { PriorityWorking } from '@/components/shared/priority-working'

/**
 * The officer's desk, as a queue.
 *
 * It used to be a stack of cards, one per complaint, each about 200px tall.
 * That is a fine shape for reading one complaint and a poor one for the job
 * this screen exists for: deciding what to do *next* out of thirty. An officer
 * triages by comparing deadlines and urgency scores against each other, and
 * cards force that comparison through a scrollbar.
 *
 * So the queue is a table sorted by deadline, and the work — issuing a crew,
 * inspecting what came back, reading why GCCE scored something urgent — opens
 * under the row it belongs to. Nothing was removed; it stopped being spread
 * over a screen and a half each.
 */
function InspectPanel({ task, onDone }: { task: DeskItem; onDone: () => void }) {
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
    const [error, setError] = useState<string | null>(null)

    async function decide(accept: boolean) {
        if (!accept && !note.trim()) {
            return setError('Say what is wrong before sending it back to the crew.')
        }
        setBusy(accept ? 'accept' : 'reject')
        setError(null)
        try {
            await apiClient.verifyWork(task.id, accept, note || undefined)
            onDone()
        } catch (err) {
            setError(messageFrom(err, 'Could not record your decision.'))
        } finally {
            setBusy(null)
        }
    }

    return (
        <div className="space-y-3 rounded-[var(--radius-lg)] border border-[color:var(--escalate-border)] bg-[color:var(--escalate-bg)] p-4">
            {error && <ErrorBanner message={error} />}

            <p className="text-sm text-[color:var(--escalate-fg)]">
                {task.assignedWorker?.fullName ?? 'The crew'} has reported this complete. Inspect the
                work before it counts as resolved.
            </p>

            <div>
                <label htmlFor={`insp-${task.id}`} className="mb-1.5 block text-sm font-medium">
                    Inspection note
                </label>
                <Textarea
                    id={`insp-${task.id}`}
                    rows={2}
                    maxLength={2000}
                    placeholder="What did you find on site?"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                />
            </div>

            <div className="flex flex-wrap gap-2">
                <Button onClick={() => void decide(true)} disabled={busy !== null}>
                    {busy === 'accept' && <Loader2 className="animate-spin" />}
                    Accept the work
                </Button>
                <Button onClick={() => void decide(false)} variant="outline" disabled={busy !== null}>
                    {busy === 'reject' && <Loader2 className="animate-spin" />}
                    Send back to crew
                </Button>
                <Button asChild variant="ghost">
                    <Link href={`/complaints/${task.id}`}>See the evidence photo</Link>
                </Button>
            </div>
        </div>
    )
}

/** Everything about one complaint that does not belong in a column. */
function DeskDetail({ task, onChanged }: { task: DeskItem; onChanged: () => void }) {
    const [panel, setPanel] = useState<'none' | 'issue' | 'inspect' | 'why'>('none')

    return (
        <div className="space-y-3">
            <p className="max-w-3xl text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                {task.description}
            </p>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[color:var(--muted-foreground)]">
                <span>filed {relativeTime(task.createdAt)}</span>
                {task.activeWorkOrder?.crew && <span>crew: {task.activeWorkOrder.crew.fullName}</span>}
            </div>

            {task.cluster && task.cluster.size > 1 && (
                <Callout
                    tone="info"
                    icon={<Users className="h-4 w-4" aria-hidden />}
                    title={`${task.cluster.size} residents have reported this separately`}
                >
                    Grouped as &ldquo;{task.cluster.label}&rdquo; — fixing it once closes all of them.
                </Callout>
            )}

            {task.activeWorkOrder && (
                <Callout tone="neutral" icon={<QrCode className="h-4 w-4" aria-hidden />}>
                    Job <code className="font-mono font-semibold">{task.activeWorkOrder.code}</code> is
                    out{' '}
                    {task.activeWorkOrder.openedAt
                        ? 'and has been opened'
                        : 'but has not been opened yet'}
                    .
                </Callout>
            )}

            <div className="flex flex-wrap gap-2">
                {task.needsAllotment && (
                    <Button
                        size="sm"
                        onClick={() => setPanel(panel === 'issue' ? 'none' : 'issue')}
                        aria-expanded={panel === 'issue'}
                    >
                        <QrCode />
                        {panel === 'issue' ? 'Close' : 'Give this to a crew'}
                    </Button>
                )}
                {task.status === 'AWAITING_VERIFICATION' && (
                    <Button
                        size="sm"
                        onClick={() => setPanel(panel === 'inspect' ? 'none' : 'inspect')}
                        aria-expanded={panel === 'inspect'}
                    >
                        {panel === 'inspect' ? 'Close' : 'Inspect work'}
                    </Button>
                )}
                {task.priorityScore != null && task.priorityFactors && (
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setPanel(panel === 'why' ? 'none' : 'why')}
                        aria-expanded={panel === 'why'}
                    >
                        {panel === 'why' ? 'Hide the working' : 'Why is this urgent?'}
                    </Button>
                )}
                <Button asChild size="sm" variant="outline">
                    <Link href={`/complaints/${task.id}`}>
                        <FileText />
                        Case file
                    </Link>
                </Button>
            </div>

            {panel === 'issue' && (
                <IssueWorkOrder
                    complaintId={task.id}
                    preferredTrade={task.category?.trade ?? null}
                    onIssued={onChanged}
                />
            )}
            {panel === 'why' && task.priorityFactors && (
                <PriorityWorking score={task.priorityScore ?? 0} factors={task.priorityFactors} />
            )}
            {panel === 'inspect' && (
                <InspectPanel
                    task={task}
                    onDone={() => {
                        setPanel('none')
                        onChanged()
                    }}
                />
            )}
        </div>
    )
}

export function OfficerDeskClient({
    tasks,
    scope,
}: {
    tasks: DeskItem[]
    scope: 'active' | 'awaiting' | 'done'
}) {
    const router = useRouter()
    const [search, setSearch] = useState('')
    const [openId, setOpenId] = useState<string | number | null>(null)

    if (tasks.length === 0) {
        return (
            <EmptyState
                icon={
                    scope === 'awaiting' ? (
                        <CircleCheck className="h-6 w-6" />
                    ) : (
                        <PartyPopper className="h-6 w-6" />
                    )
                }
                title={
                    scope === 'awaiting'
                        ? 'Nothing waiting on inspection'
                        : scope === 'done'
                          ? 'Nothing completed yet'
                          : 'Desk clear'
                }
                description={
                    scope === 'awaiting'
                        ? 'When a crew reports a job complete it appears here for you to inspect.'
                        : scope === 'done'
                          ? 'Work you accept will be listed here.'
                          : 'No complaints are currently assigned to you. GCCE routes new ones here automatically.'
                }
            />
        )
    }

    const columns: Column<DeskItem>[] = [
        {
            key: 'ref',
            header: 'Reference',
            width: 'w-32',
            value: (t) => t.referenceNo,
            cell: (t) => <Mono>{t.referenceNo}</Mono>,
        },
        {
            key: 'title',
            header: 'Complaint',
            value: (t) => `${t.title} ${t.description}`,
            cell: (t) => (
                <div className="flex items-center gap-2">
                    <span aria-hidden>{t.category?.icon ?? '📋'}</span>
                    <RowTitle hint={t.sector ? `Sector ${t.sector.number}` : undefined}>
                        {t.title}
                    </RowTitle>
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            value: (t) => t.status,
            cell: (t) => (
                <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge status={t.status} />
                    <EscalationBadge level={t.escalationLevel} />
                </div>
            ),
        },
        {
            key: 'priority',
            header: 'Priority',
            secondary: true,
            value: (t) => t.priority,
            cell: (t) => <PriorityBadge priority={t.priority} />,
        },
        {
            key: 'urgency',
            header: 'Urgency',
            align: 'right',
            secondary: true,
            value: (t) => t.priorityScore ?? null,
            cell: (t) =>
                t.priorityScore == null ? (
                    <span className="text-[color:var(--subtle-foreground)]">—</span>
                ) : (
                    <span className="tnum font-medium">{Math.round(t.priorityScore)}</span>
                ),
        },
        {
            key: 'crew',
            header: 'Crew',
            secondary: true,
            value: (t) => t.activeWorkOrder?.crew?.fullName ?? null,
            cell: (t) =>
                t.needsAllotment ? (
                    <Badge variant="warning">Needs a crew</Badge>
                ) : t.activeWorkOrder?.crew ? (
                    <span className="text-xs">{t.activeWorkOrder.crew.fullName}</span>
                ) : (
                    <span className="text-[color:var(--subtle-foreground)]">—</span>
                ),
        },
        {
            key: 'deadline',
            header: 'Deadline',
            align: 'right',
            // Sorted on the raw timestamp so "3h left" and "2d left" order
            // correctly against each other rather than alphabetically.
            value: (t) => (t.slaDueAt ? new Date(t.slaDueAt).getTime() : null),
            cell: (t) => {
                const d = deadlineLabel(t.slaDueAt, true)
                return (
                    <span
                        className={cn(
                            'inline-block rounded px-1.5 py-0.5 text-xs font-medium',
                            DEADLINE_TONE[d.tone],
                        )}
                    >
                        {d.text}
                    </span>
                )
            },
        },
    ]

    return (
        <div>
            <Toolbar search={search} onSearch={setSearch} placeholder="Search your desk" />

            <DataTable
                rows={tasks}
                columns={columns}
                getRowId={(t) => t.id}
                search={search}
                initialSort={{ key: 'deadline', direction: 'asc' }}
                rowTone={(t) =>
                    t.isOverdue ? 'danger' : t.escalationLevel > 0 ? 'warning' : null
                }
                empty="Nothing on your desk matches that."
                footnote="Red rows are past their deadline. Amber rows have already been escalated."
                expansion={{
                    openId,
                    onToggle: setOpenId,
                    label: (t) => `Work on ${t.referenceNo}`,
                    render: (t) => <DeskDetail task={t} onChanged={() => router.refresh()} />,
                }}
            />
        </div>
    )
}
