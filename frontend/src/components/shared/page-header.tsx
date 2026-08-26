import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageHeader({
    title,
    description,
    action,
}: {
    title: string
    description?: string
    action?: ReactNode
}) {
    return (
        <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
            <div>
                <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
                {description && (
                    <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">{description}</p>
                )}
            </div>
            {action}
        </header>
    )
}

export function SectionHeading({
    title,
    description,
    action,
    className,
}: {
    title: string
    description?: string
    action?: ReactNode
    className?: string
}) {
    return (
        <div className={cn('mb-4 flex flex-wrap items-end justify-between gap-3', className)}>
            <div>
                <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
                {description && (
                    <p className="mt-0.5 text-sm text-[color:var(--muted-foreground)]">{description}</p>
                )}
            </div>
            {action}
        </div>
    )
}

export function EmptyState({
    icon,
    title,
    description,
    action,
}: {
    icon?: ReactNode
    title: string
    description?: string
    action?: ReactNode
}) {
    return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[color:var(--input)] bg-[color:var(--card)]/60 px-6 py-14 text-center">
            {icon && <div className="mb-4 text-[color:var(--muted-foreground)]">{icon}</div>}
            <h3 className="text-sm font-semibold">{title}</h3>
            {description && (
                <p className="mt-1 max-w-sm text-sm text-[color:var(--muted-foreground)]">{description}</p>
            )}
            {action && <div className="mt-5">{action}</div>}
        </div>
    )
}

export function ErrorBanner({ message, action }: { message: string; action?: ReactNode }) {
    return (
        <div
            role="alert"
            className="mb-4 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3"
        >
            <span aria-hidden className="mt-0.5 text-red-500">
                ⚠
            </span>
            <div className="flex-1 text-sm text-red-800">{message}</div>
            {action}
        </div>
    )
}
