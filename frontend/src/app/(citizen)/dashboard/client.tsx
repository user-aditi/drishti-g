'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Inbox, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { EmptyState } from '@/components/shared/page-header'
import { StatusBadge } from '@/components/shared/status-badge'
import { isOpen } from '@/lib/constants'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Complaint } from '@/types'

type Filter = 'all' | 'open' | 'resolved'

const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'resolved', label: 'Resolved' },
]

/**
 * A resident's own complaints, as a register.
 *
 * The same table-then-record pattern the officers and the Super Admin use.
 * Residents were previously given cards while every staff screen used a table,
 * which meant two ways of reading the same object depending on who was looking
 * at it. One reading is easier to learn and easier to keep honest — and a
 * register is what a person tracking four complaints over a year actually
 * wants: dates and states lined up, not a wall of tiles.
 */
export function CitizenComplaintsClient({ complaints }: { complaints: Complaint[] }) {
    const [filter, setFilter] = useState<Filter>('all')

    // Filtering runs here rather than on the server: a citizen's own list is
    // small enough that a round trip per tab would be slower than the render.
    const visible = complaints.filter((c) => {
        if (filter === 'open') return isOpen(c.status)
        if (filter === 'resolved') return c.status === 'RESOLVED' || c.status === 'CLOSED'
        return true
    })

    const columns: Column<Complaint>[] = [
        {
            key: 'title',
            header: 'Issue',
            cell: (c) => (
                <RowTitle hint={c.category?.name ?? undefined}>{c.title}</RowTitle>
            ),
            value: (c) => c.title,
        },
        {
            key: 'ref',
            header: 'Reference',
            cell: (c) => <Mono>{c.referenceNo}</Mono>,
            value: (c) => c.referenceNo,
            secondary: true,
            width: 'w-40',
        },
        {
            key: 'status',
            header: 'Status',
            cell: (c) => <StatusBadge status={c.status} />,
            value: (c) => c.status,
            width: 'w-44',
        },
        {
            key: 'where',
            header: 'Where',
            cell: (c) => (
                <span className="text-[color:var(--muted-foreground)]">
                    {c.sector ? `Sector ${c.sector.number}` : '—'}
                </span>
            ),
            value: (c) => c.sector?.number ?? '',
            secondary: true,
            width: 'w-32',
        },
        {
            key: 'filed',
            header: 'Reported',
            align: 'right',
            cell: (c) => (
                <span className="text-[color:var(--muted-foreground)]">
                    {formatDate(c.createdAt)}
                </span>
            ),
            value: (c) => c.createdAt,
            width: 'w-32',
        },
    ]

    return (
        <div>
            <div className="mb-4 flex gap-1 rounded-md border border-[color:var(--border)] bg-[color:var(--card)] p-1">
                {FILTERS.map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => setFilter(key)}
                        aria-pressed={filter === key}
                        className={cn(
                            'flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors',
                            filter === key
                                ? 'bg-[color:var(--primary)] text-white'
                                : 'text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]',
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {visible.length === 0 ? (
                <EmptyState
                    icon={
                        filter === 'all' ? (
                            <Inbox className="h-10 w-10" />
                        ) : (
                            <SearchX className="h-10 w-10" />
                        )
                    }
                    title={filter === 'all' ? 'No complaints yet' : `Nothing ${filter}`}
                    description={
                        filter === 'all'
                            ? 'When you report a civic issue it appears here, with every step it goes through.'
                            : 'Try a different filter to see your other complaints.'
                    }
                    action={
                        filter === 'all' ? (
                            <Button asChild>
                                <Link href="/complaints/new">Report your first issue</Link>
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <DataTable
                    rows={visible}
                    columns={columns}
                    getRowId={(c) => c.id}
                    linkFor={(c) => `/complaints/${c.id}`}
                    initialSort={{ key: 'filed', direction: 'desc' }}
                    rowTone={(c) =>
                        isOpen(c.status) && c.slaDueAt && new Date(c.slaDueAt) < new Date()
                            ? 'danger'
                            : null
                    }
                    footnote="Open a row to see every step it has been through, and who holds it now. Rows past their promised date are highlighted."
                />
            )}
        </div>
    )
}
