import type { ReactNode } from 'react'
import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { LinkTabs } from '@/components/shared/controls'
import { cn } from '@/lib/utils'

/**
 * The furniture of a drill-down page.
 *
 * Every record in the console — a zone, a sector, a department, a person, a
 * work — is presented the same way: a trail showing what it hangs off, a header
 * naming it and stating its condition in numbers, then tabs for the things that
 * sit *inside* it. Learning one record page teaches all of them, and the trail
 * means you always know how you got here and how to get back up.
 */

export interface Crumb {
    label: string
    href?: string
}

/**
 * Where this record sits, as links.
 *
 * Named after the real chain — "The city › Zone I › Work Circle 2 › Sector 62"
 * — rather than after the URL, because the reader is navigating an authority,
 * not a file tree.
 */
export function Trail({ items }: { items: Crumb[] }) {
    return (
        <nav aria-label="Breadcrumb" className="mb-3">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-[color:var(--muted-foreground)]">
                {items.map((crumb, index) => {
                    const isLast = index === items.length - 1
                    return (
                        <li key={`${crumb.label}-${index}`} className="inline-flex items-center gap-1">
                            {crumb.href && !isLast ? (
                                <Link
                                    href={crumb.href}
                                    className="rounded px-1 py-0.5 transition-colors hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                                >
                                    {crumb.label}
                                </Link>
                            ) : (
                                <span
                                    className={cn(
                                        'px-1 py-0.5',
                                        isLast && 'font-semibold text-[color:var(--foreground)]',
                                    )}
                                >
                                    {crumb.label}
                                </span>
                            )}
                            {!isLast && <ChevronRight className="h-3 w-3 opacity-40" aria-hidden />}
                        </li>
                    )
                })}
            </ol>
        </nav>
    )
}

export interface Stat {
    label: string
    value: ReactNode
    /** Colours the number when it means something is wrong. */
    tone?: 'danger' | 'warning' | 'good'
    href?: string
}

const STAT_TONE: Record<'danger' | 'warning' | 'good', string> = {
    danger: 'text-[color:var(--error)]',
    warning: 'text-[color:var(--warning-fg)]',
    good: 'text-[color:var(--success)]',
}

/**
 * The record's name and its condition, in one block.
 *
 * The stats are deliberately few and always the same kind of thing: how much
 * work is here, and how much of it has gone wrong. A header that tries to show
 * everything shows nothing.
 */
export function RecordHeader({
    icon,
    title,
    subtitle,
    badges,
    stats,
    actions,
}: {
    icon?: ReactNode
    title: string
    subtitle?: ReactNode
    badges?: ReactNode
    stats?: Stat[]
    actions?: ReactNode
}) {
    return (
        <header className="panel mb-5 px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex min-w-0 items-start gap-3">
                    {icon && (
                        <span aria-hidden className="mt-0.5 text-2xl leading-none">
                            {icon}
                        </span>
                    )}
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
                            {badges}
                        </div>
                        {subtitle && (
                            <p className="mt-0.5 text-sm text-[color:var(--muted-foreground)]">
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>
                {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
            </div>

            {stats && stats.length > 0 && (
                <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-[color:var(--border)] pt-3.5 sm:grid-cols-3 lg:grid-cols-5">
                    {stats.map((stat) => {
                        const body = (
                            <>
                                <dt className="label-cap">{stat.label}</dt>
                                <dd
                                    className={cn(
                                        'tnum mt-1 text-lg font-semibold leading-none',
                                        stat.tone && STAT_TONE[stat.tone],
                                    )}
                                >
                                    {stat.value}
                                </dd>
                            </>
                        )
                        return stat.href ? (
                            <Link
                                key={stat.label}
                                href={stat.href}
                                className="rounded-[var(--radius-md)] transition-colors hover:bg-[color:var(--sunken)]"
                            >
                                {body}
                            </Link>
                        ) : (
                            <div key={stat.label}>{body}</div>
                        )
                    })}
                </dl>
            )}
        </header>
    )
}

export interface DetailTab {
    key: string
    label: string
    count?: number
}

/**
 * What sits inside this record.
 *
 * Tabs are links carrying `?tab=`, so a view of a sector's complaints is a URL
 * somebody can send to the officer responsible for it.
 */
export function RecordTabs({
    tabs,
    active,
    basePath,
}: {
    tabs: DetailTab[]
    active: string
    basePath: string
}) {
    return <LinkTabs tabs={tabs} active={active} basePath={basePath} />
}

/** A heading above a table inside a record page, with room for one action. */
export function TableCaption({
    title,
    hint,
    action,
}: {
    title: string
    hint?: string
    action?: ReactNode
}) {
    return (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
            <div>
                <h2 className="text-sm font-semibold">{title}</h2>
                {hint && (
                    <p className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">{hint}</p>
                )}
            </div>
            {action}
        </div>
    )
}

/** The one tab that has nothing in it yet, said plainly. */
export function NothingHere({ children }: { children: ReactNode }) {
    return (
        <p className="rounded-[var(--radius-xl)] border border-dashed border-[color:var(--border-strong)] px-4 py-14 text-center text-sm text-[color:var(--muted-foreground)]">
            {children}
        </p>
    )
}
