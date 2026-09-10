import * as React from 'react'
import { cn } from '@/lib/utils'

/** A plain block standing in for content that has not arrived. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return <div className={cn('loading-block', className)} {...props} />
}

/**
 * Placeholder rows shaped like the register they precede.
 *
 * Matching the row height matters more than it looks: a placeholder of a
 * different height makes every row jump when the data lands, and the reader
 * loses the line they were about to click.
 */
function RegisterSkeleton({ rows = 8, columns = 6 }: { rows?: number; columns?: number }) {
    return (
        <div className="divide-y divide-line border-t border-line" aria-hidden>
            {Array.from({ length: rows }).map((_, r) => (
                <div key={r} className="flex items-center gap-4 px-3 py-2.5">
                    {Array.from({ length: columns }).map((_, c) => (
                        <Skeleton key={c} className="h-3.5 flex-1" />
                    ))}
                </div>
            ))}
        </div>
    )
}

export { Skeleton, RegisterSkeleton }
