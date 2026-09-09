import type { ReactNode } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

/**
 * The vocabulary every screen is built from.
 *
 * Before this file the app had five tab controls, three filter-chip styles and
 * four different ways of drawing a coloured banner, because each screen grew
 * its own. They are all one thing now. A screen that needs a surface uses
 * Panel; one that needs to switch views uses Segmented; one that needs to say
 * something in colour uses Callout. Nothing here reaches for a raw Tailwind
 * colour — everything comes from the tokens in globals.css, which is what lets
 * the whole product follow a theme into dark mode.
 */

// --- Surfaces ----------------------------------------------------------------

/**
 * A panel: the one raised surface in the product.
 *
 * `flush` drops the padding for panels whose child draws its own edges — a
 * table, a map, a list of rows that need to touch the sides.
 */
export function Panel({
    children,
    className,
    flush = false,
    tone,
}: {
    children: ReactNode
    className?: string
    flush?: boolean
    /** Tints the whole panel when its condition matters more than its contents. */
    tone?: Tone
}) {
    return (
        <div
            className={cn(
                'panel overflow-hidden',
                !flush && 'p-5',
                tone && TONE_PANEL[tone],
                className,
            )}
        >
            {children}
        </div>
    )
}

/**
 * The head of a panel: a name, an optional line of explanation, one action.
 *
 * `sunken` gives it the inset bar treatment used above tables, so a table panel
 * and a content panel read as the same object with different fillings.
 */
export function PanelHeader({
    title,
    description,
    action,
    sunken = false,
    className,
}: {
    title: ReactNode
    description?: ReactNode
    action?: ReactNode
    sunken?: boolean
    className?: string
}) {
    return (
        <div
            className={cn(
                'flex flex-wrap items-start justify-between gap-3',
                sunken &&
                    'border-b border-[color:var(--border)] bg-[color:var(--sunken)] px-4 py-3',
                className,
            )}
        >
            <div className="min-w-0">
                <h2 className="text-sm font-semibold tracking-tight">{title}</h2>
                {description && (
                    <p className="mt-0.5 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                        {description}
                    </p>
                )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    )
}

// --- Tones -------------------------------------------------------------------

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'escalate' | 'brand'

/** Banner fills: tint, border and a foreground legible on the tint. */
const TONE_FILL: Record<Tone, string> = {
    neutral:
        'bg-[color:var(--neutral-bg)] border-[color:var(--neutral-border)] text-[color:var(--neutral-fg)]',
    info: 'bg-[color:var(--info-bg)] border-[color:var(--info-border)] text-[color:var(--info-fg)]',
    success:
        'bg-[color:var(--success-bg)] border-[color:var(--success-border)] text-[color:var(--success-fg)]',
    warning:
        'bg-[color:var(--warning-bg)] border-[color:var(--warning-border)] text-[color:var(--warning-fg)]',
    danger: 'bg-[color:var(--error-bg)] border-[color:var(--error-border)] text-[color:var(--error-fg)]',
    escalate:
        'bg-[color:var(--escalate-bg)] border-[color:var(--escalate-border)] text-[color:var(--escalate-fg)]',
    brand: 'bg-[color:var(--accent)] border-[color:var(--primary)]/25 text-[color:var(--accent-foreground)]',
}

const TONE_PANEL: Record<Tone, string> = {
    neutral: '',
    info: 'border-[color:var(--info-border)]',
    success: 'border-[color:var(--success-border)]',
    warning: 'border-[color:var(--warning-border)]',
    danger: 'border-[color:var(--error-border)]',
    escalate: 'border-[color:var(--escalate-border)]',
    brand: 'border-[color:var(--primary)]/30',
}

/** The solid of a tone — for left rules, dots and bars. */
export const TONE_SOLID: Record<Tone, string> = {
    neutral: 'var(--subtle-foreground)',
    info: 'var(--info)',
    success: 'var(--success)',
    warning: 'var(--warning)',
    danger: 'var(--error)',
    escalate: 'var(--escalate)',
    brand: 'var(--primary)',
}

/** Text in a tone's colour, on the page background rather than on a tint. */
export const TONE_TEXT: Record<Tone, string> = {
    neutral: 'text-[color:var(--muted-foreground)]',
    info: 'text-[color:var(--info)]',
    success: 'text-[color:var(--success)]',
    warning: 'text-[color:var(--warning)]',
    danger: 'text-[color:var(--error)]',
    escalate: 'text-[color:var(--escalate)]',
    brand: 'text-[color:var(--primary)]',
}

/**
 * Something the reader needs told in colour: a warning, a result, a note.
 *
 * This replaces the hand-rolled tinted blocks
 * that had appeared on eight screens in six slightly different shades.
 */
export function Callout({
    tone = 'neutral',
    icon,
    title,
    children,
    action,
    className,
}: {
    tone?: Tone
    icon?: ReactNode
    title?: ReactNode
    children?: ReactNode
    action?: ReactNode
    className?: string
}) {
    return (
        <div
            className={cn(
                'flex items-start gap-3 rounded-[var(--radius-lg)] border px-4 py-3 text-sm',
                TONE_FILL[tone],
                className,
            )}
        >
            {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
            <div className="min-w-0 flex-1">
                {title && <p className="font-semibold leading-snug">{title}</p>}
                {children && (
                    <div className={cn('leading-relaxed', title && 'mt-0.5 text-[13px] opacity-90')}>
                        {children}
                    </div>
                )}
            </div>
            {action && <div className="shrink-0">{action}</div>}
        </div>
    )
}

// --- Numbers -----------------------------------------------------------------

export interface Stat {
    label: string
    value: ReactNode
    hint?: string
    tone?: Tone
    href?: string
}

/**
 * A row of headline numbers, as one banded strip rather than as four cards.
 *
 * Four separate shadowed cards made four unrelated objects out of what is
 * really one reading of one thing. Dividing a single panel into columns says
 * "these numbers belong together and are measured the same way", and it costs a
 * third of the vertical space, which on a queue screen is space the queue gets.
 */
export function StatStrip({ stats, className }: { stats: Stat[]; className?: string }) {
    if (stats.length === 0) return null

    return (
        <dl
            className={cn(
                'panel grid divide-y divide-[color:var(--border)] sm:grid-cols-2 sm:divide-x sm:divide-y-0',
                stats.length >= 4 && 'lg:grid-cols-4',
                stats.length === 3 && 'lg:grid-cols-3',
                stats.length === 5 && 'lg:grid-cols-5',
                className,
            )}
        >
            {stats.map((stat) => {
                const body = (
                    <>
                        <dt className="label-cap">{stat.label}</dt>
                        <dd
                            className={cn(
                                'tnum mt-2 font-display text-[1.75rem] font-semibold leading-none tracking-tight',
                                stat.tone ? TONE_TEXT[stat.tone] : 'text-[color:var(--foreground)]',
                            )}
                        >
                            {stat.value}
                        </dd>
                        {stat.hint && (
                            <p className="mt-1.5 text-xs leading-snug text-[color:var(--muted-foreground)]">
                                {stat.hint}
                            </p>
                        )}
                    </>
                )

                return stat.href ? (
                    <Link
                        key={stat.label}
                        href={stat.href}
                        className="px-5 py-4 transition-colors hover:bg-[color:var(--sunken)]"
                    >
                        {body}
                    </Link>
                ) : (
                    <div key={stat.label} className="px-5 py-4">
                        {body}
                    </div>
                )
            })}
        </dl>
    )
}

/**
 * A record's fields, as a two-column definition list.
 *
 * Facts about one thing are tabular data with one row — so they get rendered as
 * a table would render them, aligned down a single label column, rather than as
 * prose with bold bits in it.
 */
export function KeyValue({
    items,
    className,
    columns = 1,
}: {
    items: { label: string; value: ReactNode }[]
    className?: string
    columns?: 1 | 2
}) {
    return (
        <dl
            className={cn(
                'divide-y divide-[color:var(--border)] text-sm',
                columns === 2 && 'sm:grid sm:grid-cols-2 sm:gap-x-8 sm:divide-y-0',
                className,
            )}
        >
            {items.map((item) => (
                <div
                    key={item.label}
                    className={cn(
                        'flex items-baseline justify-between gap-4 py-2',
                        columns === 2 && 'sm:border-b sm:border-[color:var(--border)]',
                    )}
                >
                    <dt className="shrink-0 text-xs text-[color:var(--muted-foreground)]">
                        {item.label}
                    </dt>
                    <dd className="min-w-0 text-right font-medium">{item.value}</dd>
                </div>
            ))}
        </dl>
    )
}

/**
 * A labelled proportion bar.
 *
 * Used by the status funnel, the department breakdown and anywhere else a
 * count wants to be compared against its siblings.
 */
export function MeterRow({
    label,
    value,
    max,
    display,
    colour,
}: {
    label: ReactNode
    value: number
    max: number
    /** What to print on the right. Defaults to the raw value. */
    display?: ReactNode
    /** A CSS colour. Defaults to the brand. */
    colour?: string
}) {
    const pct = max > 0 ? (value / max) * 100 : 0

    return (
        <div>
            <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate font-medium">{label}</span>
                <span className="tnum shrink-0 text-[color:var(--muted-foreground)]">
                    {display ?? value}
                </span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color:var(--muted)]">
                <div
                    className="h-full rounded-full"
                    style={{
                        width: `${Math.max(pct, value > 0 ? 2 : 0)}%`,
                        background: colour ?? 'var(--primary)',
                    }}
                />
            </div>
        </div>
    )
}
