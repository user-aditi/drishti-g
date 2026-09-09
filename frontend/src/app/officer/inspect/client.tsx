'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CircleCheck, Loader2, Phone, ShieldCheck, TriangleAlert } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, ErrorBanner } from '@/components/shared/page-header'
import { PriorityBadge } from '@/components/shared/status-badge'
import { SubmittedBy } from '@/components/shared/assurance'
import { TRADE_LABEL } from '@/lib/constants'
import { formatDateTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { VerificationQueueItem } from '@/types'

export function VerificationQueueClient({ items }: { items: VerificationQueueItem[] }) {
    if (items.length === 0) {
        return (
            <EmptyState
                icon={<ShieldCheck className="h-6 w-6" />}
                title="Nothing is waiting on you"
                description="Work with solid proof closes on the resident's confirmation, and recycled or stale proof is refused before it reaches you. Only disputes and unanswered weak proof land here."
            />
        )
    }

    return (
        <div className="space-y-4">
            <p className="rounded-lg bg-[color:var(--muted)] px-4 py-2.5 text-sm text-[color:var(--muted-foreground)]">
                {items.length} {items.length === 1 ? 'job needs' : 'jobs need'} a decision only you
                can make — everything else was settled without you.
            </p>
            {items.map((item) => (
                <QueueRow key={item.id} item={item} />
            ))}
        </div>
    )
}

function QueueRow({ item }: { item: VerificationQueueItem }) {
    const router = useRouter()
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
    const [error, setError] = useState<string | null>(null)

    // The two reasons a job lands here are different problems, and an officer
    // should be able to tell them apart before reading anything else.
    const disputed = item.complaint.citizenConfirmed === false

    async function rule(accept: boolean) {
        setBusy(accept ? 'accept' : 'reject')
        setError(null)
        try {
            await apiClient.crew.rule(item.id, accept, note || undefined)
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not record your decision.'))
            setBusy(null)
        }
    }

    return (
        <Card
            className={cn(
                'p-4',
                disputed ? 'border-l-4 border-l-[color:var(--error)]' : 'border-l-4 border-l-[color:var(--warning)]',
            )}
        >
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        {item.complaint.category && (
                            <span aria-hidden>{item.complaint.category.icon}</span>
                        )}
                        <h2 className="font-semibold leading-tight">{item.complaint.title}</h2>
                        <PriorityBadge priority={item.complaint.priority} />
                        {disputed ? (
                            <Badge variant="danger">Resident disputed it</Badge>
                        ) : (
                            <Badge variant="warning">Resident never answered</Badge>
                        )}
                    </div>
                    <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                        <span className="font-mono">{item.complaint.referenceNo}</span>
                        {item.complaint.sector && ` · Sector ${item.complaint.sector.number}`}
                        {item.crew && ` · done by ${item.crew.fullName} (${TRADE_LABEL[item.crew.trade]})`}
                        {item.submittedAt && ` · submitted ${relativeTime(item.submittedAt)}`}
                    </p>
                </div>

                {item.crew?.phone && (
                    <a
                        href={`tel:${item.crew.phone}`}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-[color:var(--input)] px-3 py-1.5 text-xs font-medium"
                    >
                        <Phone className="h-3.5 w-3.5" aria-hidden />
                        Ring the crew
                    </a>
                )}
            </div>

            {/* What the resident said, when they said anything. This is the
                evidence the officer is actually adjudicating. */}
            {disputed && (
                <div className="mt-3 rounded-lg border border-[color:var(--error-border)] bg-[color:var(--error-bg)] px-3 py-2.5">
                    <p className="text-xs font-semibold text-[color:var(--error-fg)]">
                        {item.complaint.citizen?.fullName ?? 'The resident'} says it is not done
                    </p>
                    {item.complaint.feedbackComment && (
                        <p className="mt-1 text-sm text-[color:var(--error-fg)]">
                            &ldquo;{item.complaint.feedbackComment}&rdquo;
                        </p>
                    )}
                    {item.complaint.citizenProofUrl && (
                        <a
                            href={item.complaint.citizenProofUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-2 block w-fit"
                        >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={item.complaint.citizenProofUrl}
                                alt="The resident's photo"
                                className="h-28 w-auto rounded-lg border border-[color:var(--error-border)] object-cover"
                            />
                        </a>
                    )}
                </div>
            )}

            {item.submission && (
                <div className="mt-3">
                    <SubmittedBy
                        crewName={item.crew?.fullName ?? null}
                        level={item.submission.identityAssurance}
                        selfieUrl={item.submission.selfieUrl}
                    />
                </div>
            )}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <ProofPanel
                    title="What the crew sent"
                    files={item.submission?.files ?? []}
                    note={item.submission?.note ?? null}
                    when={item.submission?.submittedAt ?? null}
                />
                <ProofPanel
                    title="What was reported originally"
                    files={
                        item.complaint.photoUrl
                            ? [{ id: -1, url: item.complaint.photoUrl, kind: 'IMAGE', capturedAt: null }]
                            : []
                    }
                    note={item.complaint.description}
                    when={null}
                />
            </div>

            {item.verification && (
                <details className="mt-3 rounded-lg border border-[color:var(--border)] px-3 py-2">
                    <summary className="cursor-pointer text-xs font-medium">
                        Automated checks scored this {Math.round(item.verification.score)} out of 100
                    </summary>
                    <ul className="mt-2 space-y-1.5">
                        {item.verification.checks.map((c) => (
                            <li key={c.check} className="flex items-start gap-2 text-xs">
                                <span
                                    aria-hidden
                                    className={cn(
                                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold text-white',
                                        c.passed ? 'bg-[color:var(--success)]' : 'bg-[color:var(--border-strong)]',
                                    )}
                                >
                                    {c.passed ? '✓' : '!'}
                                </span>
                                <span>
                                    <span className="font-medium">{c.label}</span>
                                    <span className="text-[color:var(--muted-foreground)]">
                                        {' '}
                                        — {c.detail}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            {error && (
                <div className="mt-3">
                    <ErrorBanner message={error} />
                </div>
            )}

            <div className="mt-3">
                <label htmlFor={`note-${item.id}`} className="text-sm font-medium">
                    What did you find?{' '}
                    <span className="font-normal text-[color:var(--muted-foreground)]">(optional)</span>
                </label>
                <Textarea
                    id={`note-${item.id}`}
                    rows={2}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Recorded against the complaint and shown to the resident."
                    className="mt-1"
                />
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => void rule(true)} disabled={busy !== null}>
                    {busy === 'accept' ? <Loader2 className="animate-spin" /> : <CircleCheck />}
                    The work was done — close it
                </Button>
                <Button variant="outline" onClick={() => void rule(false)} disabled={busy !== null}>
                    {busy === 'reject' ? <Loader2 className="animate-spin" /> : <TriangleAlert />}
                    Not done — send it back
                </Button>
                <Button asChild size="sm" variant="ghost">
                    <Link href={`/complaints/${item.complaint.id}`}>Full case file</Link>
                </Button>
            </div>
        </Card>
    )
}

/** Side-by-side evidence: what was reported, and what came back. */
function ProofPanel({
    title,
    files,
    note,
    when,
}: {
    title: string
    files: { id: number; url: string; kind: string; capturedAt: string | null }[]
    note: string | null
    when: string | null
}) {
    return (
        <div className="rounded-lg border border-[color:var(--border)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                {title}
                {when && ` · ${formatDateTime(when)}`}
            </p>

            {files.length === 0 ? (
                <p className="mt-2 text-xs text-[color:var(--muted-foreground)] opacity-70">
                    No photograph.
                </p>
            ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                    {files.map((f) =>
                        f.kind === 'IMAGE' ? (
                            <a key={f.id} href={f.url} target="_blank" rel="noreferrer">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={f.url}
                                    alt=""
                                    className="h-28 w-auto rounded border border-[color:var(--border)] object-cover"
                                />
                            </a>
                        ) : (
                            <a
                                key={f.id}
                                href={f.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex h-28 w-24 items-center justify-center rounded border border-[color:var(--border)] bg-[color:var(--muted)] text-xs font-medium"
                            >
                                Open {f.kind.toLowerCase()}
                            </a>
                        ),
                    )}
                </div>
            )}

            {note && (
                <p className="mt-2 line-clamp-3 text-xs text-[color:var(--muted-foreground)]">
                    {note}
                </p>
            )}
        </div>
    )
}
