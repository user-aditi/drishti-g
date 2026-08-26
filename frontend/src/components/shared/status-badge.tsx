import { ArrowUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { BAND_META, PRIORITY_META, RANK_LABEL, RANK_STYLE, STATUS_META } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { ComplaintStatus, Priority, Rank, RiskBand } from '@/types'

export function StatusBadge({ status }: { status: ComplaintStatus }) {
    const meta = STATUS_META[status]
    return (
        <Badge className={meta.className}>
            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
            {meta.label}
        </Badge>
    )
}

export function PriorityBadge({ priority }: { priority: Priority }) {
    const meta = PRIORITY_META[priority]
    return <Badge className={meta.className}>{meta.label}</Badge>
}

export function RankBadge({ rank, title }: { rank: Rank; title?: string | null }) {
    return <Badge className={RANK_STYLE[rank]}>{title ?? RANK_LABEL[rank]}</Badge>
}

export function RiskBadge({ band, score }: { band: RiskBand; score?: number }) {
    const meta = BAND_META[band]
    return (
        <Badge className={meta.className}>
            {score !== undefined && <span className="tnum font-semibold">{Math.round(score)}</span>}
            {meta.label}
        </Badge>
    )
}

/** Shown when a complaint has been pushed up the chain of command. */
export function EscalationBadge({ level }: { level: number }) {
    if (level <= 0) return null
    return (
        <Badge variant="purple">
            <ArrowUp className="h-3 w-3" />
            Escalated{level > 1 ? ` ×${level}` : ''}
        </Badge>
    )
}
