import type { ReactNode } from 'react'
import { TriangleAlert } from 'lucide-react'
import { Callout } from '@/components/shared/surface'
import { cn } from '@/lib/utils'

/**
 * The furniture at the top of a screen, and the two things a screen says when
 * it has nothing to show or something has gone wrong.
 *
 * Every page in the product opens the same way: an optional eyebrow naming
 * where you are in the authority, the page's name, one line saying what it is
 * for, and at most one primary action. Consistency here is what makes forty
 * screens feel like one system.
 */
export function PageHeader({
    eyebrow,
    title,
    description,
    action,
    className,
}: {
    /** Where this sits — a department, a sector, a rank. Quiet, above the name. */
    eyebrow?: ReactNode
    title: string
    description?: ReactNode
    action?: ReactNode
    className?: string
}) {
    return (
        <header
            className={cn(
                'mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[color:var(--border)] pb-5',
                className,
            )}
        >
            <div className="min-w-0">
                {eyebrow && <p className="label-cap mb-1.5">{eyebrow}</p>}
                <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                {description && (
                    <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                        {description}
                    </p>
                )}
            </div>
            {action && <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div>}
        </header>
    )
}

export function SectionHeading({
    title,
    description,
    action,
    className,
}: {
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
    className?: string
}) {
    return (
        <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
            <div className="min-w-0">
                <h2 className="text-base font-semibold tracking-tight">{title}</h2>
                {description && (
                    <p className="mt-0.5 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                        {description}
                    </p>
                )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    )
}

export function EmptyState({
    icon,
    title,
    description,
    action,
    className,
}: {
    icon?: ReactNode
    title: string
    description?: string
    action?: ReactNode
    className?: string
}) {
    return (
        <div
            className={cn(
                'flex flex-col items-center justify-center rounded-[var(--radius-xl)] border border-dashed border-[color:var(--border-strong)] bg-[color:var(--card)]/50 px-6 py-16 text-center',
                className,
            )}
        >
            {icon && (
                <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--muted)] text-[color:var(--subtle-foreground)]">
                    {icon}
                </div>
            )}
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && (
                <p className="mt-1.5 max-w-md text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                    {description}
                </p>
            )}
            {action && <div className="mt-5">{action}</div>}
        </div>
    )
}

/** Something failed. One shape for it, everywhere. */
export function ErrorBanner({
    message,
    action,
    className,
}: {
    message: ReactNode
    action?: ReactNode
    className?: string
}) {
    return (
        <div role="alert" className={cn('mb-4', className)}>
            <Callout
                tone="danger"
                icon={<TriangleAlert className="h-4 w-4" aria-hidden />}
                action={action}
            >
                {message}
            </Callout>
        </div>
    )
}
