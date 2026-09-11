import { CalendarClock } from 'lucide-react'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Which day this system thinks it is.
 *
 * This is not a nicety. Every "overdue" figure on every screen is a comparison
 * against a configured reference date, not against the browser's clock. The
 * records are a snapshot — NYC's statuses as published on the day the corpus was
 * pulled — and that snapshot date is the only one on which every field of every
 * row is true at once, so it is the date the system stands on. Shifting the
 * imported dates forward instead would destroy the seasonality the data is worth
 * having for. So the dates stay real and the observer moves.
 *
 * The consequence is that an operator reading an overdue count is reading a
 * count taken on a particular day, and is entitled to be told which one — and,
 * because this is a historical backlog, to be told why nearly all of it is
 * overdue. Any agent screen that reports an overdue number shows this next to it.
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
                — the day these records were taken from NYC Open Data. Every deadline and
                overdue count here is measured against it, not against today, which is why
                most of what is still open reads as overdue: it is a historical backlog.
                Requests filed through this replica are live, and run on today&rsquo;s clock.
            </span>
        </div>
    )
}

/** The same fact, compressed, for a page that already carries the long form. */
export function ReferenceDateInline({ referenceDate }: { referenceDate: string }) {
    return (
        <span
            className="mono text-sm text-ink-soft"
            title={`Overdue is evaluated against ${formatDateTime(referenceDate)}, the day these records were taken from NYC Open Data — not today.`}
        >
            as at {formatDate(referenceDate)}
        </span>
    )
}
