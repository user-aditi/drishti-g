import { Badge } from '@/components/ui/badge'
import { STATUS_META, isOpenStatus } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { RequestStatus, ServiceRequest } from '@/types'

/**
 * The small, repeated pieces of a service request.
 *
 * They live together because they have to agree with each other: the pill in a
 * register row, the pill on the detail page and the dot on the map are the same
 * fact, and a reader scanning between them should never have to check.
 */

/**
 * A status, coloured by family.
 *
 * Note what is *not* here: overdue. Overdue is not one of NYC's statuses — it
 * is a comparison between now and a deadline this project derived, so it is
 * rendered as its own separate mark. Folding it into the status column would
 * quietly turn our statistic into the City's record.
 */
export function StatusPill({ status, className }: { status: RequestStatus; className?: string }) {
    const meta = STATUS_META[status]
    return (
        <Badge tone={meta.tone} className={cn('w-fit', className)}>
            {meta.label}
        </Badge>
    )
}

/** Past its derived deadline. Only ever shown next to a route to the reason. */
export function OverdueMark({ className }: { className?: string }) {
    return (
        <Badge tone="stop" className={cn('w-fit', className)}>
            Past derived deadline<span aria-hidden> †</span>
        </Badge>
    )
}

/**
 * Whether this row records something New York did, or something this replica
 * did.
 *
 * A reader is entitled to tell those apart. An imported row is a historical
 * fact from the City's published data and nobody here can change it; a filed
 * row is an action taken inside a university project. Presenting them
 * identically would let the replica's own activity pass as municipal record.
 */
export function ProvenanceMark({ isImported }: { isImported: boolean }) {
    return isImported ? (
        <Badge tone="outline" title="Loaded from NYC Open Data — a record of a real 311 request">
            NYC Open Data record
        </Badge>
    ) : (
        <Badge tone="outline" title="Filed in this replica — never sent to the City of New York">
            Filed in this replica
        </Badge>
    )
}

/** An SR number, always monospaced, always tabular. */
export function SrNumber({ value, className }: { value: string; className?: string }) {
    return <span className={cn('mono', className)}>{value}</span>
}

/** Open means "not closed" — derived, because there is no OPEN-vs-rest flag. */
export const isOpen = (request: Pick<ServiceRequest, 'status'>): boolean =>
    isOpenStatus(request.status)
