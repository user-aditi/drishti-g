'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleCheck, FileText, Loader2, PartyPopper } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { CardSkeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorBanner } from '@/components/shared/page-header'
import {
    EscalationBadge,
    PriorityBadge,
    StatusBadge,
} from '@/components/shared/status-badge'
import { DEADLINE_TONE, deadlineLabel, relativeTime } from '@/lib/format'
import { TRADE_LABEL } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { CrewMember, DeskItem, Trade } from '@/types'

/**
 * Allotment: the step a naive complaint app skips.
 *
 * The Junior Engineer decides *who* does the work, from their own sector crew.
 * Without it a worker would receive complaints they have no authority to
 * triage, and the inspection afterwards would mean nothing.
 */
function AllotPanel({ task, onDone }: { task: DeskItem; onDone: () => void }) {
    const [crew, setCrew] = useState<CrewMember[]>([])
    const [preferredTrade, setPreferredTrade] = useState<string | null>(null)
    const [exactTrade, setExactTrade] = useState(true)
    const [selected, setSelected] = useState<number | null>(null)
    const [instructions, setInstructions] = useState('')
    const [loading, setLoading] = useState(true)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        apiClient
            .crewFor(task.id)
            .then((res) => {
                setCrew(res.items)
                setPreferredTrade(res.preferredTrade)
                setExactTrade(res.exactTradeAvailable)
                // Pre-select the least-loaded member, which is what an officer
                // picks by default anyway.
                setSelected(res.items[0]?.userId ?? null)
            })
            .catch(() => setError('Could not load your sector crew.'))
            .finally(() => setLoading(false))
    }, [task.id])

    async function allot() {
        if (selected == null) return
        setSubmitting(true)
        setError(null)
        try {
            await apiClient.allotJob(task.id, selected, instructions || undefined)
            onDone()
        } catch (err) {
            setError(messageFrom(err, 'Could not allot this job.'))
        } finally {
            setSubmitting(false)
        }
    }

    if (loading) {
        return (
            <div className="mt-3">
                <CardSkeleton rows={2} />
            </div>
        )
    }

    return (
        <div className="mt-4 space-y-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--muted)] p-4">
            {error && <ErrorBanner message={error} />}

            <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-sm font-medium">Allot to a member of your crew</p>
                    {preferredTrade && (
                        <span className="text-xs text-[color:var(--muted-foreground)]">
                            {exactTrade ? (
                                <>
                                    Trade required:{' '}
                                    <span className="font-medium">
                                        {TRADE_LABEL[preferredTrade as Trade]}
                                    </span>
                                </>
                            ) : (
                                <span className="text-amber-700">
                                    No {TRADE_LABEL[preferredTrade as Trade]} posted here — showing the
                                    whole crew
                                </span>
                            )}
                        </span>
                    )}
                </div>

                {crew.length === 0 ? (
                    <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
                        No field workers are posted to this sector for your department. Ask the
                        administrator to post a crew before this can be actioned.
                    </p>
                ) : (
                    <div className="space-y-1.5">
                        {crew.map((w) => (
                            <button
                                key={w.userId}
                                type="button"
                                onClick={() => setSelected(w.userId)}
                                aria-pressed={selected === w.userId}
                                className={cn(
                                    'flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-all',
                                    selected === w.userId
                                        ? 'border-[color:var(--primary)] bg-[color:var(--accent)] ring-1 ring-[color:var(--primary)]'
                                        : 'border-[color:var(--border)] bg-[color:var(--card)] hover:border-[color:var(--input)]',
                                )}
                            >
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium">{w.fullName}</span>
                                    <span className="block text-xs text-[color:var(--muted-foreground)]">
                                        {w.designationTitle}
                                        {w.employeeCode && ` · ${w.employeeCode}`}
                                    </span>
                                </span>
                                <span
                                    className={cn(
                                        'tnum shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                                        w.activeJobs === 0
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : w.activeJobs > 3
                                              ? 'bg-amber-100 text-amber-700'
                                              : 'bg-slate-100 text-slate-600',
                                    )}
                                >
                                    {w.activeJobs} active
                                </span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {crew.length > 0 && (
                <>
                    <div>
                        <label
                            htmlFor={`instr-${task.id}`}
                            className="mb-1.5 block text-sm font-medium"
                        >
                            Instructions for the crew{' '}
                            <span className="font-normal opacity-60">(optional)</span>
                        </label>
                        <Textarea
                            id={`instr-${task.id}`}
                            rows={2}
                            maxLength={2000}
                            placeholder="e.g. Take the jetting machine. Clear the full stretch, not just the mouth."
                            value={instructions}
                            onChange={(e) => setInstructions(e.target.value)}
                        />
                    </div>

                    <Button onClick={() => void allot()} disabled={submitting}>
                        {submitting && <Loader2 className="animate-spin" />}
                        Allot job
                    </Button>
                </>
            )}
        </div>
    )
}

/** Inspection: accept the reported work, or send it back to the crew. */
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
        <div className="mt-4 space-y-3 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
            {error && <ErrorBanner message={error} />}

            <p className="text-sm">
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

function DeskRow({ task, onChanged }: { task: DeskItem; onChanged: () => void }) {
    const [panel, setPanel] = useState<'none' | 'allot' | 'inspect'>('none')
    const deadline = deadlineLabel(task.slaDueAt, true)

    const accent =
        task.escalationLevel > 0
            ? 'border-l-4 border-l-purple-500'
            : deadline.tone === 'overdue'
              ? 'border-l-4 border-l-red-500'
              : deadline.tone === 'urgent'
                ? 'border-l-4 border-l-amber-500'
                : ''

    return (
        <Card className={cn('p-4', accent)}>
            <div className="flex items-start gap-3">
                <div
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--muted)] text-lg"
                    aria-hidden
                >
                    {task.category?.icon ?? '📋'}
                </div>

                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                        <h3 className="min-w-0 flex-1 font-medium">{task.title}</h3>
                        <div className="flex shrink-0 flex-wrap gap-1.5">
                            <EscalationBadge level={task.escalationLevel} />
                            <StatusBadge status={task.status} />
                            {task.priority !== 'MEDIUM' && <PriorityBadge priority={task.priority} />}
                        </div>
                    </div>

                    <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                        {task.description}
                    </p>

                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[color:var(--muted-foreground)]">
                        <span className="font-mono text-[11px] opacity-70">{task.referenceNo}</span>
                        {task.sector && <span>Sector {task.sector.number}</span>}
                        <span>filed {relativeTime(task.createdAt)}</span>
                        <span className={cn('rounded px-1.5 py-0.5 font-medium', DEADLINE_TONE[deadline.tone])}>
                            {deadline.text}
                        </span>
                        {task.assignedWorker && <span>crew: {task.assignedWorker.fullName}</span>}
                    </div>

                    <div className="mt-3 flex flex-wrap gap-2">
                        {task.needsAllotment && (
                            <Button
                                size="sm"
                                onClick={() => setPanel(panel === 'allot' ? 'none' : 'allot')}
                                aria-expanded={panel === 'allot'}
                            >
                                {panel === 'allot' ? 'Close' : 'Allot to crew'}
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
                        <Button asChild size="sm" variant="outline">
                            <Link href={`/complaints/${task.id}`}>
                                <FileText />
                                Case file
                            </Link>
                        </Button>
                    </div>

                    {panel === 'allot' && (
                        <AllotPanel
                            task={task}
                            onDone={() => {
                                setPanel('none')
                                onChanged()
                            }}
                        />
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
            </div>
        </Card>
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

    if (tasks.length === 0) {
        return (
            <EmptyState
                icon={
                    scope === 'awaiting' ? (
                        <CircleCheck className="h-10 w-10" />
                    ) : (
                        <PartyPopper className="h-10 w-10" />
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

    return (
        <div className="space-y-3">
            {tasks.map((task) => (
                <DeskRow key={task.id} task={task} onChanged={() => router.refresh()} />
            ))}
        </div>
    )
}
