import * as React from 'react'
import Link from 'next/link'
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The register.
 *
 * Every list in this system is one of these: a dense table with a fixed status
 * column, tabular figures and sortable headers. Not cards. A queue of service
 * requests exists to be *compared* — this one against the four below it, this
 * column of ages down three hundred rows — and a grid of cards destroys the
 * column alignment that comparison depends on, while showing a fifth as many
 * rows per screen.
 *
 * These are plain server-renderable pieces. Sorting and paging are expressed as
 * links that change the URL, so the register works with JavaScript unavailable,
 * a row can be opened in a new tab, and a filtered view can be sent to someone
 * as a link.
 */

/**
 * The scroll frame.
 *
 * A register with eight columns is wider than a phone, and the answer is that
 * it scrolls *inside this box* — the page itself never scrolls sideways, so the
 * header and the filter bar stay where the reader left them.
 */
export function RegisterFrame({
    children,
    className,
}: {
    children: React.ReactNode
    className?: string
}) {
    return (
        <div className={cn('rounded-[var(--radius)] border border-line bg-surface', className)}>
            <div className="register-scroll">{children}</div>
        </div>
    )
}

export function RegisterTable({
    children,
    caption,
    className,
}: {
    children: React.ReactNode
    /** Named for screen readers, which otherwise announce "table" and nothing. */
    caption: string
    className?: string
}) {
    return (
        <table className={cn('w-full min-w-max border-collapse text-left', className)}>
            <caption className="sr-only">{caption}</caption>
            {children}
        </table>
    )
}

export function RegisterHead({ children }: { children: React.ReactNode }) {
    return (
        <thead className="bg-sunk">
            <tr className="border-b border-line">{children}</tr>
        </thead>
    )
}

export function RegisterBody({ children }: { children: React.ReactNode }) {
    return <tbody className="divide-y divide-line">{children}</tbody>
}

type Align = 'left' | 'right'

export function Th({
    children,
    align = 'left',
    className,
    ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { align?: Align }) {
    return (
        <th
            scope="col"
            className={cn(
                'label-cap whitespace-nowrap px-3 py-2 font-medium',
                align === 'right' && 'text-right',
                className,
            )}
            {...props}
        >
            {children}
        </th>
    )
}

/**
 * A sortable column header.
 *
 * The whole header is the control, and it is an anchor rather than a button so
 * that sorting is a real navigation: back returns to the previous order, and
 * `aria-sort` tells a screen reader what the table is currently ordered by
 * without it having to infer anything from an icon.
 */
export function SortHeader({
    children,
    href,
    direction,
    align = 'left',
}: {
    children: React.ReactNode
    href: string
    /** null when the table is not sorted by this column. */
    direction: 'asc' | 'desc' | null
    align?: Align
}) {
    const Icon = direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ChevronsUpDown
    return (
        <th
            scope="col"
            aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
            className={cn('whitespace-nowrap p-0', align === 'right' && 'text-right')}
        >
            <Link
                href={href}
                className={cn(
                    'label-cap flex w-full items-center gap-1.5 px-3 py-2 hover:text-ink',
                    align === 'right' && 'justify-end',
                    direction && 'text-ink',
                )}
            >
                {children}
                <Icon className="h-3 w-3 shrink-0" aria-hidden />
            </Link>
        </th>
    )
}

export function Tr({
    children,
    className,
    ...props
}: React.HTMLAttributes<HTMLTableRowElement>) {
    return (
        <tr className={cn('relative bg-surface hover:bg-sunk', className)} {...props}>
            {children}
        </tr>
    )
}

export function Td({
    children,
    align = 'left',
    mono,
    className,
    ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { align?: Align; mono?: boolean }) {
    return (
        <td
            className={cn(
                'px-3 py-2 align-middle text-base text-ink-mid',
                align === 'right' && 'text-right',
                mono && 'mono text-sm',
                className,
            )}
            {...props}
        >
            {children}
        </td>
    )
}

/**
 * The link that opens a row.
 *
 * It stretches over the whole row so the row is clickable, but it is still a
 * single focusable anchor with real text — which means one tab stop per row and
 * a screen reader that announces where the row goes, rather than the dozen
 * stops and silence a div-with-onClick would produce.
 */
export function RowLink({
    href,
    children,
    className,
}: {
    href: string
    children: React.ReactNode
    className?: string
}) {
    return (
        <Link
            href={href}
            className={cn(
                'mono font-medium text-brand after:absolute after:inset-0 after:content-[""] hover:underline',
                className,
            )}
        >
            {children}
        </Link>
    )
}

/** What a register says when the filters match nothing. */
export function EmptyRow({ colSpan, children }: { colSpan: number; children: React.ReactNode }) {
    return (
        <tr>
            <td colSpan={colSpan} className="px-3 py-10 text-center text-base text-ink-soft">
                {children}
            </td>
        </tr>
    )
}

/**
 * Server-side paging, as links.
 *
 * There are 355,430 rows behind this. The register asks for one page and is
 * told the total; it never receives the set. Everything about this component
 * assumes that — there is no "select all", and the page numbers are computed
 * from `total`, not from anything held in memory.
 */
export function Pagination({
    page,
    pageSize,
    total,
    hrefForPage,
}: {
    page: number
    pageSize: number
    total: number
    hrefForPage: (page: number) => string
}) {
    const lastPage = Math.max(1, Math.ceil(total / pageSize))
    const first = total === 0 ? 0 : (page - 1) * pageSize + 1
    const last = Math.min(page * pageSize, total)

    return (
        <nav
            aria-label="Pages"
            className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-3 py-2.5"
        >
            <p className="text-sm text-ink-soft">
                <span className="mono tnum text-ink">{first.toLocaleString('en-US')}</span>
                {'–'}
                <span className="mono tnum text-ink">{last.toLocaleString('en-US')}</span> of{' '}
                <span className="mono tnum text-ink">{total.toLocaleString('en-US')}</span>
            </p>

            <div className="flex items-center gap-2">
                <PageLink href={hrefForPage(1)} disabled={page <= 1}>
                    First
                </PageLink>
                <PageLink href={hrefForPage(page - 1)} disabled={page <= 1}>
                    Previous
                </PageLink>
                <span className="mono tnum px-1 text-sm text-ink-mid">
                    {page.toLocaleString('en-US')} / {lastPage.toLocaleString('en-US')}
                </span>
                <PageLink href={hrefForPage(page + 1)} disabled={page >= lastPage}>
                    Next
                </PageLink>
                <PageLink href={hrefForPage(lastPage)} disabled={page >= lastPage}>
                    Last
                </PageLink>
            </div>
        </nav>
    )
}

function PageLink({
    href,
    disabled,
    children,
}: {
    href: string
    disabled: boolean
    children: React.ReactNode
}) {
    const classes = 'rounded-[var(--radius)] border px-2 py-1 text-sm'

    // A dead end is a span, not a disabled link. A link that goes nowhere is
    // still a tab stop, and tabbing onto something that does nothing is worse
    // than it not being there.
    if (disabled) {
        return (
            <span className={cn(classes, 'border-line text-ink-soft opacity-50')} aria-hidden>
                {children}
            </span>
        )
    }

    return (
        <Link href={href} className={cn(classes, 'border-line-strong text-ink hover:bg-sunk')}>
            {children}
        </Link>
    )
}
