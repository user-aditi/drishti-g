import { cn } from '@/lib/utils'

/** A shimmering placeholder for content that has not arrived yet. */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
    return (
        <div
            className={cn('relative overflow-hidden rounded-[var(--radius-md)] bg-[color:var(--muted)]', className)}
            {...props}
        >
            <div
                className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-[color:var(--card)]/70 to-transparent"
                style={{ animation: 'shimmer 1.6s infinite' }}
            />
        </div>
    )
}

/** A card-shaped placeholder, for lists that load a row at a time. */
function CardSkeleton({ rows = 3 }: { rows?: number }) {
    return (
        <div className="space-y-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-5">
            <Skeleton className="h-4 w-1/3" />
            {Array.from({ length: rows }).map((_, i) => (
                <Skeleton key={i} className="h-3 w-full" />
            ))}
        </div>
    )
}

export { Skeleton, CardSkeleton }
