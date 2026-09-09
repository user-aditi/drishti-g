'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The controls above a register: find, narrow, switch view.
 *
 * There used to be five of these. The risk queue had pill tabs in a bordered
 * tray, the audit trail had the same tray with different padding, the console
 * had underlined tabs, the people page had loose rounded chips and the org
 * pages had a fourth thing. They were all doing one of two jobs — choosing
 * which set of records to look at, or filtering the set already on screen — so
 * there are two controls here and no more.
 */

// --- Search ------------------------------------------------------------------

/** The strip above every register: find, narrow, then act. */
export function Toolbar({
    search,
    onSearch,
    placeholder = 'Search these records',
    filters,
    actions,
    className,
}: {
    search: string
    onSearch: (v: string) => void
    placeholder?: string
    filters?: ReactNode
    actions?: ReactNode
    className?: string
}) {
    return (
        <div className={cn('mb-4 flex flex-wrap items-center gap-2', className)}>
            <div className="relative min-w-56 flex-1">
                <Search
                    className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[color:var(--subtle-foreground)]"
                    aria-hidden
                />
                <input
                    type="search"
                    value={search}
                    onChange={(e) => onSearch(e.target.value)}
                    placeholder={placeholder}
                    aria-label={placeholder}
                    className="h-10 w-full rounded-[var(--radius-lg)] border border-[color:var(--input)] bg-[color:var(--card)] pl-9 pr-3 text-sm shadow-[var(--shadow-xs)] transition-shadow placeholder:text-[color:var(--subtle-foreground)] focus-visible:border-[color:var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)]/25"
                />
            </div>
            {filters}
            {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
    )
}

// --- Choosing a view ---------------------------------------------------------

export interface SegmentedOption<T extends string> {
    value: T
    label: string
    /** Shown as a trailing count. Omit where a count would be noise. */
    count?: number
    /** Makes this segment a link, for tab state that belongs in the URL. */
    href?: string
}

/**
 * Switch between views of one thing.
 *
 * `underline` is the default and is what a record page or a register uses: it
 * reads as a set of sections belonging to the page above it. `pill` is for a
 * control that sits inside a panel and needs to look like an input rather than
 * like navigation.
 */
export function Segmented<T extends string>({
    options,
    value,
    onChange,
    label,
    variant = 'underline',
    className,
}: {
    options: SegmentedOption<T>[]
    value: T
    onChange?: (v: T) => void
    label?: string
    variant?: 'underline' | 'pill'
    className?: string
}) {
    if (variant === 'pill') {
        return (
            <div
                role="group"
                aria-label={label}
                className={cn(
                    'inline-flex flex-wrap gap-1 rounded-[var(--radius-lg)] border border-[color:var(--border)] bg-[color:var(--sunken)] p-1',
                    className,
                )}
            >
                {options.map((opt) => {
                    const active = opt.value === value
                    const inner = (
                        <>
                            {opt.label}
                            {opt.count !== undefined && (
                                <span
                                    className={cn(
                                        'tnum rounded px-1.5 py-0.5 text-[10px] font-semibold',
                                        active
                                            ? 'bg-white/20'
                                            : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]',
                                    )}
                                >
                                    {opt.count}
                                </span>
                            )}
                        </>
                    )
                    const classes = cn(
                        'inline-flex items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium transition-colors',
                        active
                            ? 'bg-[color:var(--primary)] text-[color:var(--primary-foreground)] shadow-[var(--shadow-xs)]'
                            : 'text-[color:var(--muted-foreground)] hover:bg-[color:var(--card)] hover:text-[color:var(--foreground)]',
                    )

                    return opt.href ? (
                        <Link
                            key={opt.value}
                            href={opt.href}
                            scroll={false}
                            aria-current={active ? 'page' : undefined}
                            className={classes}
                        >
                            {inner}
                        </Link>
                    ) : (
                        <button
                            key={opt.value}
                            type="button"
                            aria-pressed={active}
                            onClick={() => onChange?.(opt.value)}
                            className={classes}
                        >
                            {inner}
                        </button>
                    )
                })}
            </div>
        )
    }

    return (
        <div
            role={onChange ? 'tablist' : undefined}
            aria-label={label}
            className={cn(
                'mb-5 flex flex-wrap gap-1 border-b border-[color:var(--border)]',
                className,
            )}
        >
            {options.map((opt) => {
                const active = opt.value === value
                const inner = (
                    <>
                        {opt.label}
                        {opt.count !== undefined && (
                            <span
                                className={cn(
                                    'tnum rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                                    active
                                        ? 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]'
                                        : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]',
                                )}
                            >
                                {opt.count}
                            </span>
                        )}
                    </>
                )
                const classes = cn(
                    '-mb-px inline-flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-medium transition-colors',
                    active
                        ? 'border-[color:var(--primary)] text-[color:var(--primary)]'
                        : 'border-transparent text-[color:var(--muted-foreground)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--foreground)]',
                )

                return opt.href ? (
                    <Link
                        key={opt.value}
                        href={opt.href}
                        scroll={false}
                        aria-current={active ? 'page' : undefined}
                        className={classes}
                    >
                        {inner}
                    </Link>
                ) : (
                    <button
                        key={opt.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => onChange?.(opt.value)}
                        className={classes}
                    >
                        {inner}
                    </button>
                )
            })}
        </div>
    )
}

// --- Narrowing a set ---------------------------------------------------------

export interface ChipOption {
    value: string
    label: string
    /** Shown as a trailing count. Omit when a count would be noise. */
    count?: number
}

/**
 * A one-of-many filter over the records already on screen.
 *
 * Small sets only — past about eight options this becomes a wall and a select
 * is kinder.
 */
export function FilterChips({
    options,
    value,
    onChange,
    label,
    className,
}: {
    options: ChipOption[]
    value: string
    onChange: (v: string) => void
    label: string
    className?: string
}) {
    return (
        <div role="group" aria-label={label} className={cn('flex flex-wrap items-center gap-1.5', className)}>
            {options.map((opt) => {
                const active = opt.value === value
                return (
                    <button
                        key={opt.value || 'all'}
                        type="button"
                        aria-pressed={active}
                        onClick={() => onChange(opt.value)}
                        className={cn(
                            'inline-flex h-10 items-center gap-1.5 rounded-[var(--radius-lg)] border px-3 text-xs font-medium transition-colors',
                            active
                                ? 'border-[color:var(--primary)] bg-[color:var(--primary)] text-[color:var(--primary-foreground)]'
                                : 'border-[color:var(--border)] bg-[color:var(--card)] text-[color:var(--muted-foreground)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--foreground)]',
                        )}
                    >
                        {opt.label}
                        {opt.count !== undefined && (
                            <span
                                className={cn(
                                    'tnum rounded px-1 text-[10px]',
                                    active ? 'bg-white/20' : 'bg-[color:var(--muted)]',
                                )}
                            >
                                {opt.count}
                            </span>
                        )}
                    </button>
                )
            })}
        </div>
    )
}

/**
 * Tabs whose state lives in the URL.
 *
 * Kept as a named wrapper because "a view of a sector's complaints is a link
 * someone can send to the officer responsible for it" is a rule worth having a
 * name for, not because it behaves differently from Segmented.
 */
export function LinkTabs({
    tabs,
    active,
    basePath,
    param = 'tab',
}: {
    tabs: { key: string; label: string; count?: number }[]
    active: string
    basePath: string
    param?: string
}) {
    return (
        <Segmented
            value={active}
            options={tabs.map((t) => ({
                value: t.key,
                label: t.label,
                count: t.count,
                href: `${basePath}?${param}=${t.key}`,
            }))}
        />
    )
}
