import * as React from 'react'
import { cn } from '@/lib/utils'

/**
 * The page's own column.
 *
 * Every screen sits in this, so the left edge of a heading on the queue lines
 * up with the left edge of a heading on the map. Spacing between blocks is the
 * shell's `gap`, never a margin on the block itself — a margin set by the child
 * is a margin the next screen cannot predict.
 */
export function PageShell({
    children,
    className,
    width = 'wide',
}: {
    children: React.ReactNode
    className?: string
    /** `text` for reading, `wide` for registers and maps. */
    width?: 'wide' | 'text'
}) {
    return (
        <div
            className={cn(
                'mx-auto flex flex-col gap-6 px-4 py-8 sm:px-6',
                width === 'wide' ? 'max-w-[1400px]' : 'max-w-3xl',
                className,
            )}
        >
            {children}
        </div>
    )
}

/**
 * The one page heading, so every screen starts the same distance down.
 *
 * `actions` sits on the same line as the title rather than above it, because on
 * a register the title is the least important thing on the screen and should
 * not push the first row further down than it has to.
 */
export function PageHeading({
    title,
    description,
    actions,
    className,
}: {
    title: string
    description?: React.ReactNode
    actions?: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn('flex flex-wrap items-start justify-between gap-4', className)}>
            <div>
                <h1 className="text-2xl font-semibold text-ink">{title}</h1>
                {description && (
                    <p className="prose-measure mt-1 text-base text-ink-mid">{description}</p>
                )}
            </div>
            {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
    )
}

/** A labelled figure. Used in rows of three or four above a register. */
export function Figure({
    label,
    value,
    hint,
}: {
    label: string
    value: React.ReactNode
    hint?: React.ReactNode
}) {
    return (
        <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-line bg-surface px-4 py-3">
            <span className="label-cap">{label}</span>
            <span className="mono text-2xl font-semibold text-ink">{value}</span>
            {hint && <span className="text-sm text-ink-soft">{hint}</span>}
        </div>
    )
}

/** A key/value line on a detail page. The label column is fixed so they align. */
export function Field({
    label,
    children,
    mono,
}: {
    label: string
    children: React.ReactNode
    mono?: boolean
}) {
    return (
        <div className="flex flex-col gap-1 border-b border-line py-2.5 last:border-b-0 sm:flex-row sm:gap-4">
            <dt className="label-cap sm:w-48 sm:shrink-0 sm:pt-0.5">{label}</dt>
            <dd className={cn('min-w-0 text-base text-ink', mono && 'mono text-sm')}>{children}</dd>
        </div>
    )
}
