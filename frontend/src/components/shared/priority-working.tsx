import { cn } from '@/lib/utils'
import type { PriorityFactor } from '@/types'

/**
 * Why this complaint outranks that one.
 *
 * The same shape as the GRIE explanation, and for the same reason: a priority
 * order an officer cannot interrogate is one they quietly stop trusting, and
 * then work the desk by gut anyway. Each bar is scaled against the factor's own
 * maximum rather than against the total, so a reader can see at a glance which
 * inputs are near their ceiling and which had nothing to contribute.
 */
export function PriorityWorking({
    score,
    factors,
    className,
}: {
    score: number
    factors: PriorityFactor[]
    className?: string
}) {
    const ordered = [...factors].sort((a, b) => b.contribution - a.contribution)

    return (
        <div
            className={cn(
                'mt-4 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-4',
                className,
            )}
        >
            <div className="mb-3 flex items-baseline justify-between gap-3 border-b border-[color:var(--border)] pb-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
                    How this urgency was worked out
                </span>
                <span className="tnum text-sm font-bold">{score} / 100</span>
            </div>

            <ul className="space-y-2.5">
                {ordered.map((factor) => {
                    const share = factor.weight > 0 ? factor.contribution / factor.weight : 0
                    return (
                        <li key={factor.factor}>
                            <div className="flex items-baseline justify-between gap-3 text-sm">
                                <span className="font-medium">{factor.label}</span>
                                <span className="tnum shrink-0 text-xs text-[color:var(--muted-foreground)]">
                                    {factor.contribution} of {factor.weight}
                                </span>
                            </div>
                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color:var(--muted)]">
                                <div
                                    className={cn(
                                        'h-full rounded-full',
                                        share >= 0.75
                                            ? 'bg-[color:var(--error)]'
                                            : share >= 0.4
                                              ? 'bg-amber-500'
                                              : 'bg-[color:var(--primary)]',
                                    )}
                                    style={{ width: `${Math.max(share * 100, 2)}%` }}
                                />
                            </div>
                            <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                                {factor.explanation}
                            </p>
                        </li>
                    )
                })}
            </ul>

            <p className="mt-3 border-t border-[color:var(--border)] pt-2 text-xs text-[color:var(--muted-foreground)]">
                The eight figures above add up to {score}. Anything at or above 55 is treated as
                high, 75 as critical.
            </p>
        </div>
    )
}
