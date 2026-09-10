import { CalendarClock } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Which day this system thinks it is.
 *
 * This is not a nicety. Every "overdue" figure on every screen is a comparison
 * against a configured reference date, not against the browser's clock, because
 * the corpus ends on 2025-12-31: read against real time, all 355,430 imported
 * requests are past their deadline, every queue sorts identically and every
 * breach rate reads 100%. The alternative — shifting the imported dates forward
 * so they look recent — would destroy the seasonality the data is worth having
 * for. So the dates stay real and the observer moves.
 *
 * The consequence is that an operator reading "3,543 overdue" is reading a
 * count taken on a particular day, and is entitled to be told which one. Any
 * agent screen that reports an overdue number shows this next to it.
 */
export function ReferenceDate({
    referenceDate,
    className,
}: {
    referenceDate: string
    className?: string
}) {
    return (
        <div
            className={cn(
                'flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius)] border border-line bg-sunk px-3 py-2 text-sm',
                className,
            )}
        >
            <CalendarClock className="h-3.5 w-3.5 shrink-0 text-ink-soft" aria-hidden />
            <span className="text-ink-mid">Evaluated as at</span>
            <time dateTime={referenceDate} className="mono font-medium text-ink">
                {formatDate(referenceDate)}
            </time>
            <span className="text-ink-soft">
                — every deadline and overdue count on this screen is measured against that date,
                not against today. The published records end there.
            </span>
        </div>
    )
}

/** The same fact, compressed, for a page that already carries the long form. */
export function ReferenceDateInline({ referenceDate }: { referenceDate: string }) {
    return (
        <span
            className="mono text-sm text-ink-soft"
            title={`Overdue is evaluated against ${formatDateTime(referenceDate)}, the system reference date, because the published corpus ends there.`}
        >
            as at {formatDate(referenceDate)}
        </span>
    )
}
