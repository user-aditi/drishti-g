import * as React from 'react'
import { AlertTriangle, Info } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * What a screen says when it has nothing to show, and when it broke.
 *
 * Both cases are worth designing rather than defaulting, because they are what
 * a reader sees at the worst moment. The rule they share: say which of the two
 * it is. "No results" and "we could not reach the service" look identical if
 * you render an empty table for both, and they call for opposite responses —
 * change the filter, or come back later.
 */

export function ErrorNotice({
    title = 'This could not be loaded',
    message,
    className,
}: {
    title?: string
    message: string
    className?: string
}) {
    return (
        <div
            role="alert"
            className={cn(
                'flex items-start gap-3 rounded-[var(--radius)] border border-stop/40 bg-stop-soft px-4 py-3',
                className,
            )}
        >
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-stop" aria-hidden />
            <div className="prose-measure">
                <p className="text-base font-semibold text-ink">{title}</p>
                <p className="mt-0.5 text-base text-ink-mid">{message}</p>
            </div>
        </div>
    )
}

export function InfoNotice({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    return (
        <div
            className={cn(
                'flex items-start gap-3 rounded-[var(--radius)] border border-line bg-brand-soft px-4 py-3',
                className,
            )}
        >
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-brand-ink" aria-hidden />
            <div className="prose-measure text-base text-brand-ink">{children}</div>
        </div>
    )
}

/** The empty state for a whole screen, as opposed to an empty table row. */
export function EmptyNotice({
    title,
    children,
    className,
}: {
    title: string
    children?: React.ReactNode
    className?: string
}) {
    return (
        <div
            className={cn(
                'rounded-[var(--radius)] border border-dashed border-line-strong px-4 py-10 text-center',
                className,
            )}
        >
            <p className="text-lg font-medium text-ink">{title}</p>
            {children && (
                <div className="prose-measure mx-auto mt-1 text-base text-ink-soft">{children}</div>
            )}
        </div>
    )
}
