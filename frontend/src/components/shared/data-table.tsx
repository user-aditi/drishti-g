'use client'

import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowDown, ArrowUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * The one table the whole product is built from.
 *
 * Every register — sectors, staff, works, the officer's desk, the risk queue,
 * the audit trail — is the same object: a sortable grid where a row is a record
 * and opening a row shows that record. Learning the table once means learning
 * every screen.
 *
 * Sorting and searching happen in the browser on purpose. These registers are
 * hundreds of rows, not millions, and a filter that responds on the keystroke
 * is worth far more here than pagination would be.
 */

export interface Column<T> {
    key: string
    header: string
    /** What the cell shows. */
    cell: (row: T) => ReactNode
    /**
     * The sortable, searchable value behind the cell. Columns without one are
     * inert — an actions column, say — and are skipped by both.
     */
    value?: (row: T) => string | number | null | undefined
    align?: 'left' | 'right'
    /** A Tailwind width class, for columns that should not fight for space. */
    width?: string
    /** Hidden below `sm`, for columns that are useful but not essential. */
    secondary?: boolean
}

/**
 * Opening a row in place.
 *
 * Some registers carry work, not just records: a desk item needs a crew issued,
 * a flagged sector needs its reasoning read and a decision recorded. Those rows
 * expand downward into a full-width panel rather than navigating away, because
 * the officer is working a queue and losing their place in it costs them the
 * comparison they were making.
 */
export interface Expansion<T> {
    /** The panel under the open row. */
    render: (row: T) => ReactNode
    openId: string | number | null
    onToggle: (id: string | number | null) => void
    /** Accessible name for the toggle, e.g. "Open complaint NOI-123". */
    label?: (row: T) => string
}

interface DataTableProps<T> {
    rows: T[]
    columns: Column<T>[]
    getRowId: (row: T) => string | number
    /** Free text matched against every column that defines `value`. */
    search?: string
    /**
     * Makes each row navigate to a record page.
     *
     * The first column's cell becomes a real link, so the row works with
     * middle-click, keyboard and a screen reader — clicking anywhere else on
     * the row is only a convenience on top of that. A table using this must not
     * put its own link inside the first column.
     */
    linkFor?: (row: T) => string
    onRowClick?: (row: T) => void
    /** The open record, highlighted so the drawer and the grid agree. */
    activeId?: string | number | null
    initialSort?: { key: string; direction: 'asc' | 'desc' }
    empty?: ReactNode
    /** Tints a whole row — used to make overdue and blacklisted rows visible. */
    rowTone?: (row: T) => 'danger' | 'warning' | 'muted' | null
    /** Rendered under the grid, next to the record count. */
    footnote?: ReactNode
    /** Lets rows open in place. See Expansion. */
    expansion?: Expansion<T>
    /** Drops the count line under the grid, for tables inside a panel. */
    hideCount?: boolean
}

const TONE_CLASS: Record<'danger' | 'warning' | 'muted', string> = {
    danger: 'bg-[color:var(--error-bg)]',
    warning: 'bg-[color:var(--warning-bg)]',
    muted: 'opacity-55',
}

/** The left rule that makes a toned row readable at a glance down the column. */
const TONE_RULE: Record<'danger' | 'warning' | 'muted', string> = {
    danger: 'shadow-[inset_3px_0_0_0_var(--error)]',
    warning: 'shadow-[inset_3px_0_0_0_var(--warning)]',
    muted: '',
}

export function DataTable<T>({
    rows,
    columns,
    getRowId,
    search = '',
    linkFor,
    onRowClick,
    activeId = null,
    initialSort,
    empty,
    rowTone,
    footnote,
    expansion,
    hideCount = false,
}: DataTableProps<T>) {
    const router = useRouter()
    const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(
        initialSort ?? null,
    )

    // A linked table still gets row-level click for convenience; the anchor in
    // the first cell is what makes it navigable without a mouse. An expanding
    // table opens the row instead — it has nowhere to navigate to.
    const activate = expansion
        ? (row: T) => {
              const id = getRowId(row)
              expansion.onToggle(expansion.openId === id ? null : id)
          }
        : linkFor
          ? (row: T) => router.push(linkFor(row))
          : onRowClick

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase()

        const filtered = needle
            ? rows.filter((row) =>
                  columns.some((col) => {
                      const v = col.value?.(row)
                      return v != null && String(v).toLowerCase().includes(needle)
                  }),
              )
            : rows

        if (!sort) return filtered

        const column = columns.find((c) => c.key === sort.key)
        if (!column?.value) return filtered

        const factor = sort.direction === 'asc' ? 1 : -1
        return [...filtered].sort((a, b) => {
            const av = column.value!(a)
            const bv = column.value!(b)

            // Empty cells sink to the bottom whichever way the column is sorted,
            // because "no deadline" is never the most urgent row.
            if (av == null && bv == null) return 0
            if (av == null) return 1
            if (bv == null) return -1

            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * factor
            return String(av).localeCompare(String(bv), 'en', { numeric: true }) * factor
        })
    }, [rows, columns, search, sort])

    function toggleSort(key: string) {
        setSort((current) => {
            if (current?.key !== key) return { key, direction: 'asc' }
            if (current.direction === 'asc') return { key, direction: 'desc' }
            return null
        })
    }

    const columnCount = columns.length + (expansion ? 1 : 0)

    return (
        <div>
            <div className="panel">
                <div className="overflow-x-auto">
                    <table className="w-full min-w-full border-collapse text-sm">
                        <thead>
                            <tr className="border-b border-[color:var(--border)] bg-[color:var(--sunken)]">
                                {columns.map((col) => {
                                    const sortable = col.value != null
                                    const active = sort?.key === col.key
                                    return (
                                        <th
                                            key={col.key}
                                            scope="col"
                                            aria-sort={
                                                active
                                                    ? sort!.direction === 'asc'
                                                        ? 'ascending'
                                                        : 'descending'
                                                    : 'none'
                                            }
                                            className={cn(
                                                'label-cap whitespace-nowrap px-4 py-3',
                                                col.align === 'right' ? 'text-right' : 'text-left',
                                                col.width,
                                                col.secondary && 'hidden sm:table-cell',
                                            )}
                                        >
                                            {sortable ? (
                                                <button
                                                    type="button"
                                                    onClick={() => toggleSort(col.key)}
                                                    className={cn(
                                                        'inline-flex items-center gap-1 rounded transition-colors hover:text-[color:var(--foreground)]',
                                                        active && 'text-[color:var(--foreground)]',
                                                        col.align === 'right' && 'flex-row-reverse',
                                                    )}
                                                >
                                                    {col.header}
                                                    {active ? (
                                                        sort!.direction === 'asc' ? (
                                                            <ArrowUp className="h-3 w-3" aria-hidden />
                                                        ) : (
                                                            <ArrowDown className="h-3 w-3" aria-hidden />
                                                        )
                                                    ) : (
                                                        <ChevronsUpDown
                                                            className="h-3 w-3 opacity-40"
                                                            aria-hidden
                                                        />
                                                    )}
                                                </button>
                                            ) : (
                                                col.header
                                            )}
                                        </th>
                                    )
                                })}
                                {expansion && <th className="w-10 px-2 py-3" />}
                            </tr>
                        </thead>

                        <tbody className="divide-y divide-[color:var(--border)]">
                            {visible.map((row) => {
                                const id = getRowId(row)
                                const tone = rowTone?.(row) ?? null
                                const isActive = activeId != null && id === activeId
                                const isOpen = expansion?.openId === id

                                return [
                                    <tr
                                        key={id}
                                        onClick={activate ? () => activate(row) : undefined}
                                        // A linked row already has a focusable anchor in its first
                                        // cell, and an expanding row has its chevron button, so
                                        // making the row itself focusable would double every tab
                                        // stop in the table.
                                        tabIndex={onRowClick && !linkFor && !expansion ? 0 : undefined}
                                        onKeyDown={
                                            onRowClick && !linkFor && !expansion
                                                ? (e) => {
                                                      if (e.key === 'Enter' || e.key === ' ') {
                                                          e.preventDefault()
                                                          onRowClick(row)
                                                      }
                                                  }
                                                : undefined
                                        }
                                        className={cn(
                                            'transition-colors',
                                            tone && TONE_CLASS[tone],
                                            tone && TONE_RULE[tone],
                                            activate &&
                                                'cursor-pointer hover:bg-[color:var(--sunken)] focus-within:bg-[color:var(--sunken)]',
                                            (isActive || isOpen) &&
                                                'bg-[color:var(--primary-wash)] shadow-[inset_3px_0_0_0_var(--primary)]',
                                        )}
                                    >
                                        {columns.map((col, columnIndex) => {
                                            const content = col.cell(row)
                                            return (
                                                <td
                                                    key={col.key}
                                                    className={cn(
                                                        'px-4 py-3 align-middle',
                                                        col.align === 'right' && 'text-right tnum',
                                                        col.secondary && 'hidden sm:table-cell',
                                                    )}
                                                >
                                                    {linkFor && columnIndex === 0 ? (
                                                        <Link
                                                            href={linkFor(row)}
                                                            className="block rounded focus-visible:outline-none"
                                                        >
                                                            {content}
                                                        </Link>
                                                    ) : (
                                                        content
                                                    )}
                                                </td>
                                            )
                                        })}

                                        {expansion && (
                                            <td className="px-2 py-3 text-right">
                                                <button
                                                    type="button"
                                                    aria-expanded={isOpen}
                                                    aria-label={
                                                        expansion.label?.(row) ??
                                                        (isOpen ? 'Close this record' : 'Open this record')
                                                    }
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        expansion.onToggle(isOpen ? null : id)
                                                    }}
                                                    className="inline-flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                                                >
                                                    <ChevronDown
                                                        className={cn(
                                                            'h-4 w-4 transition-transform',
                                                            isOpen && 'rotate-180',
                                                        )}
                                                        aria-hidden
                                                    />
                                                </button>
                                            </td>
                                        )}
                                    </tr>,

                                    expansion && isOpen ? (
                                        <tr key={`${id}-open`} className="bg-[color:var(--sunken)]">
                                            <td
                                                colSpan={columnCount}
                                                className="border-l-[3px] border-l-[color:var(--primary)] px-4 py-4"
                                            >
                                                {expansion.render(row)}
                                            </td>
                                        </tr>
                                    ) : null,
                                ]
                            })}
                        </tbody>
                    </table>
                </div>

                {visible.length === 0 && (
                    <div className="px-4 py-14 text-center text-sm text-[color:var(--muted-foreground)]">
                        {empty ?? 'No records match this view.'}
                    </div>
                )}
            </div>

            {!hideCount && (
                <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-[color:var(--muted-foreground)]">
                    <span className="tnum">
                        {visible.length === rows.length
                            ? `${rows.length} ${rows.length === 1 ? 'record' : 'records'}`
                            : `${visible.length} of ${rows.length} records`}
                    </span>
                    {footnote}
                </div>
            )}
        </div>
    )
}

/** A monospaced identifier — codes, reference numbers, employee numbers. */
export function Mono({ children }: { children: ReactNode }) {
    return (
        <span className="font-mono text-xs text-[color:var(--muted-foreground)]">{children}</span>
    )
}

/** The primary label in a row: what the record *is*. */
export function RowTitle({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
    return (
        <div className="min-w-0">
            <div className="truncate font-medium text-[color:var(--foreground)]">{children}</div>
            {hint && (
                <div className="truncate text-xs text-[color:var(--muted-foreground)]">{hint}</div>
            )}
        </div>
    )
}

/** A count that reads as nothing when it is zero, rather than as a loud "0". */
export function Count({ value, suffix }: { value: number; suffix?: string }) {
    return value === 0 ? (
        <span className="text-[color:var(--subtle-foreground)]">—</span>
    ) : (
        <span className="tnum">
            {value}
            {suffix ? <span className="ml-1 text-xs opacity-60">{suffix}</span> : null}
        </span>
    )
}
