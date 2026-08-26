import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { EscalationBadge, PriorityBadge, StatusBadge } from './status-badge'
import { DEADLINE_TONE, deadlineLabel, relativeTime } from '@/lib/format'
import { isOpen } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { Complaint } from '@/types'

/**
 * One complaint in a list.
 *
 * `href` is passed in rather than derived, because the same complaint is
 * reached at different paths by a citizen, an officer and a supervisor.
 */
export function ComplaintCard({
    complaint,
    href,
    showDeadline = false,
}: {
    complaint: Complaint
    href: string
    showDeadline?: boolean
}) {
    const open = isOpen(complaint.status)
    const deadline = deadlineLabel(complaint.slaDueAt, open)

    return (
        <Link href={href} className="block">
            <Card className="p-4 transition-all hover:border-[color:var(--primary)] hover:shadow-md">
                <div className="flex items-start gap-3">
                    <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[color:var(--muted)] text-lg"
                        aria-hidden
                    >
                        {complaint.category?.icon ?? '📋'}
                    </div>

                    <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                            <h3 className="min-w-0 flex-1 truncate font-medium">{complaint.title}</h3>
                            <div className="flex shrink-0 flex-wrap gap-1.5">
                                <StatusBadge status={complaint.status} />
                            </div>
                        </div>

                        <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                            {complaint.description}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[color:var(--muted-foreground)]">
                            <span className="font-mono text-[11px] opacity-70">{complaint.referenceNo}</span>
                            {complaint.sector && <span>Sector {complaint.sector.number}</span>}
                            {complaint.department && <span>{complaint.department.name}</span>}
                            <span>{relativeTime(complaint.createdAt)}</span>

                            {showDeadline && complaint.slaDueAt && (
                                <span
                                    className={cn(
                                        'rounded px-1.5 py-0.5 font-medium',
                                        DEADLINE_TONE[deadline.tone],
                                    )}
                                >
                                    {deadline.text}
                                </span>
                            )}
                            <EscalationBadge level={complaint.escalationLevel} />
                            {complaint.priority !== 'MEDIUM' && (
                                <PriorityBadge priority={complaint.priority} />
                            )}
                        </div>
                    </div>
                </div>
            </Card>
        </Link>
    )
}
