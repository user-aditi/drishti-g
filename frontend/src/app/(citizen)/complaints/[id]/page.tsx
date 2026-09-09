import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, MapPin, Users } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { serverFetch } from '@/lib/api'
import { ApiError } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SupportButton } from '@/components/citizen/support-button'
import { EscalationBadge, PriorityBadge, StatusBadge } from '@/components/shared/status-badge'
import { SectionHeading } from '@/components/shared/page-header'
import { Timeline } from '@/components/shared/timeline'
import { isOfficer, isOpen, isSeniorOfficer } from '@/lib/constants'
import { deadlineLabel, formatDateTime, initials, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ComplaintDetail } from '@/types'
import { ComplaintActionsClient } from './client'
import { ConfirmWorkPanel } from './confirm'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
    params,
}: {
    params: { id: string }
}): Promise<Metadata> {
    return { title: `Complaint #${params.id} · DRISHTI-G` }
}

export default async function ComplaintDetailPage({ params }: { params: { id: string } }) {
    const user = await requireUser()

    let complaint: ComplaintDetail
    try {
        complaint = await serverFetch<ComplaintDetail>(`/complaints/${params.id}`)
    } catch (err) {
        // A 403 here means the complaint exists but is outside this person's
        // jurisdiction. Showing "not found" rather than "forbidden" avoids
        // confirming what they are not allowed to know about.
        if (err instanceof ApiError && (err.status === 404 || err.status === 403)) notFound()
        throw err
    }

    const open = isOpen(complaint.status)
    const deadline = deadlineLabel(complaint.slaDueAt, open)
    const isOwner = complaint.citizen?.id === user.id
    const canRate =
        isOwner &&
        complaint.feedbackRating == null &&
        (complaint.status === 'RESOLVED' || complaint.status === 'CLOSED')
    const canClose = isSeniorOfficer(user.rank) && complaint.status === 'RESOLVED'

    return (
        <div>
            <Link
                href="/"
                className="mb-4 inline-flex items-center gap-1 text-sm text-[color:var(--muted-foreground)] hover:text-[color:var(--primary)]"
            >
                <ArrowLeft className="h-4 w-4" />
                Back
            </Link>

            <div className="grid gap-5 lg:grid-cols-3">
                <div className="space-y-5 lg:col-span-2">
                    <Card className="p-5">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <p className="font-mono text-xs text-[color:var(--muted-foreground)]">
                                    {complaint.referenceNo}
                                </p>
                                <h1 className="mt-1 text-xl font-bold leading-tight">{complaint.title}</h1>
                            </div>
                            <div className="flex shrink-0 flex-wrap gap-2">
                                {complaint.isCommunity && (
                                    <Badge variant="info">
                                        <Users className="h-3 w-3" aria-hidden />
                                        Community issue
                                    </Badge>
                                )}
                                <StatusBadge status={complaint.status} />
                                <PriorityBadge priority={complaint.priority} />
                                <EscalationBadge level={complaint.escalationLevel} />
                            </div>
                        </div>

                        <p className="mt-4 whitespace-pre-wrap leading-relaxed">{complaint.description}</p>

                        {complaint.photoUrl && (
                            <a
                                href={complaint.photoUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-4 block w-fit overflow-hidden rounded-lg border border-[color:var(--border)] transition-shadow hover:shadow-md"
                            >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={complaint.photoUrl}
                                    alt="Photo submitted with the complaint"
                                    className="max-h-72 w-auto object-cover"
                                />
                            </a>
                        )}

                        {(complaint.landmark || complaint.address) && (
                            <p className="mt-4 flex items-start gap-2 text-sm text-[color:var(--muted-foreground)]">
                                <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                                {complaint.landmark ?? complaint.address}
                            </p>
                        )}
                    </Card>

                    {complaint.awaitingMyConfirmation && complaint.workProof && (
                        <ConfirmWorkPanel complaintId={complaint.id} proof={complaint.workProof} />
                    )}

                    {complaint.citizenConfirmed === false && (
                        <p className="rounded-xl border border-[color:var(--warning-border)] bg-[color:var(--warning-bg)] px-4 py-3 text-sm text-[color:var(--warning-fg)]">
                            You told us this was not actually fixed, so it went back to the officer
                            responsible with your photo attached. You will be asked again when the
                            crew reports it done.
                        </p>
                    )}

                    {complaint.isCommunity && (
                        <Card className="p-5">
                            <SectionHeading
                                title="Backed by the neighbourhood"
                                description="This was raised as a community issue, so residents of the sector can add their names to it. Enough support raises how urgently the authority treats it."
                            />

                            <SupportButton
                                complaintId={complaint.id}
                                supporters={complaint.supporters}
                                hasSupported={complaint.viewerHasSupported}
                                canSupport={complaint.viewerCanSupport}
                                isAuthor={isOwner}
                                nextThreshold={complaint.nextThreshold}
                                currentPriority={complaint.priority}
                                showEligibilityHint={!isOfficer(user.rank)}
                                size="default"
                            />

                            {complaint.supportList.length > 0 && (
                                <ul className="mt-4 space-y-2 border-t border-[color:var(--border)] pt-4">
                                    {complaint.supportList.map((s) => (
                                        <li key={s.id} className="flex items-start gap-2.5 text-sm">
                                            <span
                                                aria-hidden
                                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)] text-[10px] font-semibold text-[color:var(--accent-foreground)]"
                                            >
                                                {initials(s.fullName)}
                                            </span>
                                            <span className="min-w-0">
                                                <span className="font-medium">{s.fullName}</span>
                                                <span className="ml-2 text-xs text-[color:var(--muted-foreground)]">
                                                    {relativeTime(s.createdAt)}
                                                </span>
                                                {s.note && (
                                                    <span className="block text-xs text-[color:var(--muted-foreground)]">
                                                        “{s.note}”
                                                    </span>
                                                )}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </Card>
                    )}

                    {complaint.escalations.length > 0 && (
                        <Card className="border-[color:var(--escalate-border)] bg-[color:var(--escalate-bg)]/40 p-5">
                            <SectionHeading
                                title="Escalation history"
                                description="Each time this passed a deadline it became a more senior officer's responsibility."
                            />
                            <ul className="space-y-2">
                                {complaint.escalations.map((e) => (
                                    <li key={e.id} className="text-sm">
                                        <span className="font-medium">
                                            {e.fromLabel && e.toLabel
                                                ? `${e.fromLabel} → ${e.toLabel}`
                                                : 'Passed to a more senior officer'}
                                        </span>
                                        {e.toUser && (
                                            <span className="text-[color:var(--muted-foreground)]">
                                                {' '}
                                                · {e.toUser.fullName}
                                            </span>
                                        )}
                                        <p className="text-xs text-[color:var(--muted-foreground)]">
                                            {e.reason} · {relativeTime(e.createdAt)}
                                        </p>
                                    </li>
                                ))}
                            </ul>
                        </Card>
                    )}

                    <Card className="p-5">
                        <SectionHeading title="Progress" description="Every step, and who took it." />
                        <Timeline history={complaint.history} />
                    </Card>

                    <ComplaintActionsClient
                        complaintId={complaint.id}
                        canRate={canRate}
                        canClose={canClose}
                        feedbackRating={complaint.feedbackRating}
                        feedbackComment={complaint.feedbackComment}
                    />
                </div>

                <aside className="space-y-5">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                                Details
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <dl className="space-y-3 text-sm">
                                <div>
                                    <dt className="text-[color:var(--muted-foreground)]">Category</dt>
                                    <dd className="mt-0.5 font-medium">
                                        {complaint.category ? (
                                            <>
                                                {complaint.category.icon} {complaint.category.name}
                                            </>
                                        ) : (
                                            <span className="opacity-60">Not categorised</span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[color:var(--muted-foreground)]">Department</dt>
                                    <dd className="mt-0.5 font-medium">{complaint.department?.name ?? '—'}</dd>
                                </div>
                                <div>
                                    <dt className="text-[color:var(--muted-foreground)]">Sector</dt>
                                    <dd className="mt-0.5 font-medium">
                                        {complaint.sector ? `Sector ${complaint.sector.number}` : '—'}
                                        {complaint.sector?.circle && (
                                            <span className="block text-xs font-normal text-[color:var(--muted-foreground)]">
                                                {complaint.sector.circle.name}
                                                {complaint.sector.circle.zone &&
                                                    ` · ${complaint.sector.circle.zone.name}`}
                                            </span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[color:var(--muted-foreground)]">Officer responsible</dt>
                                    <dd className="mt-0.5 font-medium">
                                        {complaint.assignedOfficer?.fullName ?? (
                                            <span className="text-[color:var(--warning)]">Awaiting posting</span>
                                        )}
                                    </dd>
                                </div>
                                <div>
                                    <dt className="text-[color:var(--muted-foreground)]">Crew on the job</dt>
                                    <dd className="mt-0.5 font-medium">
                                        {complaint.assignedWorker?.fullName ?? (
                                            <span className="opacity-60">Not yet allotted</span>
                                        )}
                                    </dd>
                                </div>
                                {isSeniorOfficer(user.rank) && complaint.citizen && (
                                    <div>
                                        <dt className="text-[color:var(--muted-foreground)]">Filed by</dt>
                                        <dd className="mt-0.5 font-medium">{complaint.citizen.fullName}</dd>
                                    </div>
                                )}
                            </dl>
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                                Timing
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            <dl className="space-y-3 text-sm">
                                <div>
                                    <dt className="text-[color:var(--muted-foreground)]">Filed</dt>
                                    <dd className="mt-0.5">{formatDateTime(complaint.createdAt)}</dd>
                                </div>
                                <div>
                                    <dt className="text-[color:var(--muted-foreground)]">Target resolution</dt>
                                    <dd
                                        className={cn(
                                            'mt-0.5 font-medium',
                                            deadline.tone === 'overdue'
                                                ? 'text-[color:var(--error)]'
                                                : deadline.tone === 'urgent'
                                                  ? 'text-[color:var(--warning)]'
                                                  : '',
                                        )}
                                    >
                                        {complaint.slaDueAt ? formatDateTime(complaint.slaDueAt) : '—'}
                                        {open && complaint.slaDueAt && (
                                            <span className="ml-1 font-normal">({deadline.text})</span>
                                        )}
                                    </dd>
                                    {complaint.slaEstimate && (
                                        /*
                                         * What usually happens, next to what was promised.
                                         *
                                         * The deadline above is a p90 — a time this area has
                                         * historically met nine cases in ten. On its own that reads
                                         * as pessimism, because most complaints finish well inside
                                         * it. This is the sentence a resident actually wanted, and
                                         * the API decides its wording from how specific the
                                         * evidence is, so the page cannot overclaim on its own.
                                         */
                                        <p className="mt-1 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                                            {complaint.slaEstimate.sentence}
                                            {complaint.slaEstimate.support > 0 && (
                                                <span className="text-[color:var(--subtle-foreground)]">
                                                    {' '}
                                                    Based on {complaint.slaEstimate.support} similar{' '}
                                                    {complaint.slaEstimate.support === 1
                                                        ? 'complaint'
                                                        : 'complaints'}
                                                    .
                                                </span>
                                            )}
                                        </p>
                                    )}
                                </div>
                                {complaint.resolvedAt && (
                                    <div>
                                        <dt className="text-[color:var(--muted-foreground)]">Resolved</dt>
                                        <dd className="mt-0.5">{formatDateTime(complaint.resolvedAt)}</dd>
                                    </div>
                                )}
                            </dl>
                        </CardContent>
                    </Card>
                </aside>
            </div>
        </div>
    )
}
