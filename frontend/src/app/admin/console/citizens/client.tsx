'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Count, DataTable, RowTitle, type Column } from '@/components/shared/data-table'
import { Toolbar } from '@/components/console/toolbar'
import { formatDate, initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CitizenRow } from '@/types'

/** Their rating of the work done for them, as stars rather than a bare number. */
export function Rating({ value }: { value: number | null }) {
    if (value == null) return <span className="text-xs opacity-40">Not rated</span>
    const rounded = Math.round(value)
    return (
        <span
            className={cn('text-xs', value < 3 && 'font-medium text-[color:var(--error)]')}
            title={`${value.toFixed(1)} out of 5`}
        >
            {'★'.repeat(rounded)}
            {/* Hollow rather than merely faded, so the rating survives being
                read aloud, copied as text, or seen without colour. */}
            <span className="opacity-40">{'☆'.repeat(5 - rounded)}</span>
            <span className="tnum ml-1.5 text-[color:var(--muted-foreground)]">
                {value.toFixed(1)}
            </span>
        </span>
    )
}

export function CitizensClient({
    citizens,
    total,
}: {
    citizens: CitizenRow[]
    total: number
}) {
    const [search, setSearch] = useState('')

    const columns: Column<CitizenRow>[] = [
        {
            key: 'name',
            header: 'Name',
            value: (c) => `${c.fullName} ${c.email} ${c.phone ?? ''}`,
            cell: (c) => (
                <div className="flex items-center gap-2.5">
                    <span
                        aria-hidden
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[color:var(--muted)] text-[10px] font-semibold text-[color:var(--muted-foreground)]"
                    >
                        {initials(c.fullName)}
                    </span>
                    <RowTitle hint={c.email}>
                        <span className={cn(!c.isActive && 'line-through opacity-60')}>
                            {c.fullName}
                        </span>
                    </RowTitle>
                </div>
            ),
        },
        {
            key: 'phone',
            header: 'Phone',
            secondary: true,
            value: (c) => c.phone,
            cell: (c) =>
                c.phone ? (
                    <span className="tnum text-xs">{c.phone}</span>
                ) : (
                    <span className="opacity-40">—</span>
                ),
        },
        {
            key: 'sector',
            header: 'Lives in',
            value: (c) => (c.homeSector ? `Sector ${c.homeSector.number}` : null),
            cell: (c) =>
                c.homeSector ? (
                    <span className="text-xs">Sector {c.homeSector.number}</span>
                ) : (
                    <span className="text-xs opacity-40">Not set</span>
                ),
        },
        {
            key: 'filed',
            header: 'Reported',
            align: 'right',
            value: (c) => c.filed,
            cell: (c) => <Count value={c.filed} />,
        },
        {
            key: 'open',
            header: 'Still open',
            align: 'right',
            value: (c) => c.openFiled,
            cell: (c) =>
                c.openFiled === 0 ? (
                    <span className="opacity-40">—</span>
                ) : (
                    <span className="tnum font-medium">{c.openFiled}</span>
                ),
        },
        {
            key: 'rating',
            header: 'How they rated us',
            value: (c) => c.avgRating,
            cell: (c) => <Rating value={c.avgRating} />,
        },
        {
            key: 'joined',
            header: 'Registered',
            align: 'right',
            secondary: true,
            value: (c) => new Date(c.createdAt).getTime(),
            cell: (c) => (
                <span className="text-xs text-[color:var(--muted-foreground)]">
                    {formatDate(c.createdAt)}
                </span>
            ),
        },
        {
            key: 'status',
            header: 'Account',
            secondary: true,
            value: (c) => (c.isActive ? 'Active' : 'Blocked'),
            cell: (c) =>
                c.isActive ? (
                    <Badge variant="success">Active</Badge>
                ) : (
                    <Badge variant="danger">Blocked</Badge>
                ),
        },
    ]

    return (
        <div>
            <Toolbar
                search={search}
                onSearch={setSearch}
                placeholder="Search citizens by name, email or phone"
            />

            <DataTable
                rows={citizens}
                columns={columns}
                getRowId={(c) => c.id}
                search={search}
                linkFor={(c) => `/admin/console/citizens/${c.id}`}
                initialSort={{ key: 'filed', direction: 'desc' }}
                rowTone={(c) => (c.isActive ? null : 'muted')}
                empty="Nobody has registered yet."
                footnote={`${total} registered · a rating below three stars is the authority's own failure, not theirs`}
            />
        </div>
    )
}
