'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Count, DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { FilterChips, Toolbar } from '@/components/console/toolbar'
import { RANK_LABEL, RANK_STYLE } from '@/lib/constants'
import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Department, GeographyTree, Rank, StaffRow } from '@/types'
import { APPOINTABLE } from './posting-fields'
import { AppointDrawer } from './appoint'

/** Where a posting sits, in the one line a table cell has room for. */
function chargeOf(row: StaffRow): string {
    const p = row.primaryPosting
    if (!p) return '—'
    if (p.sector) return `Sector ${p.sector.number}`
    return p.circle?.name ?? p.zone?.name ?? 'Authority-wide'
}

export function StaffClient({
    staff,
    total,
    departments,
    geography,
    initialRank,
}: {
    staff: StaffRow[]
    total: number
    departments: Department[]
    geography: GeographyTree[]
    initialRank: string
}) {
    const router = useRouter()
    const [search, setSearch] = useState('')
    const [rank, setRank] = useState(initialRank)
    const [status, setStatus] = useState('')
    const [appointing, setAppointing] = useState(false)

    const rows = staff.filter((u) => {
        if (rank && u.rank !== rank) return false
        if (status === 'active' && !u.isActive) return false
        if (status === 'inactive' && u.isActive) return false
        return true
    })

    const columns: Column<StaffRow>[] = [
        {
            key: 'name',
            header: 'Name',
            value: (u) => `${u.fullName} ${u.email}`,
            cell: (u) => (
                <div className="flex items-center gap-2.5">
                    <span
                        className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold',
                            u.isActive
                                ? 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]'
                                : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]',
                        )}
                        aria-hidden
                    >
                        {initials(u.fullName)}
                    </span>
                    <RowTitle hint={u.email}>
                        <span className={cn(!u.isActive && 'line-through opacity-60')}>
                            {u.fullName}
                        </span>
                    </RowTitle>
                </div>
            ),
        },
        {
            key: 'post',
            header: 'Post',
            value: (u) => u.primaryPosting?.designationTitle ?? u.rankLabel,
            cell: (u) => (
                <Badge className={RANK_STYLE[u.rank]}>
                    {u.primaryPosting?.designationTitle ?? u.rankLabel}
                </Badge>
            ),
        },
        {
            key: 'department',
            header: 'Department',
            secondary: true,
            value: (u) => u.primaryPosting?.department?.name ?? null,
            cell: (u) =>
                u.primaryPosting?.department ? (
                    <span className="text-xs text-[color:var(--muted-foreground)]">
                        {u.primaryPosting.department.icon} {u.primaryPosting.department.name}
                    </span>
                ) : (
                    <span className="opacity-40">—</span>
                ),
        },
        {
            key: 'charge',
            header: 'Charge',
            value: (u) => chargeOf(u),
            cell: (u) => (
                <span className="text-xs">
                    {chargeOf(u)}
                    {u.postings.length > 1 && (
                        <span className="ml-1.5 text-[color:var(--muted-foreground)]">
                            +{u.postings.length - 1}
                        </span>
                    )}
                </span>
            ),
        },
        {
            key: 'load',
            header: 'Open now',
            align: 'right',
            value: (u) => u.openCases + u.openJobs,
            cell: (u) => <Count value={u.openCases + u.openJobs} />,
        },
        {
            key: 'code',
            header: 'Emp. code',
            secondary: true,
            value: (u) => u.primaryPosting?.employeeCode ?? null,
            cell: (u) =>
                u.primaryPosting?.employeeCode ? (
                    <Mono>{u.primaryPosting.employeeCode}</Mono>
                ) : (
                    <span className="opacity-40">—</span>
                ),
        },
        {
            key: 'status',
            header: 'Account',
            value: (u) => (u.isActive ? 'Active' : 'Deactivated'),
            cell: (u) =>
                u.isActive ? (
                    <Badge variant="success">Active</Badge>
                ) : (
                    <Badge variant="danger">Deactivated</Badge>
                ),
        },
    ]

    return (
        <div>
            <Toolbar
                search={search}
                onSearch={setSearch}
                placeholder="Search by name, email or post"
                filters={
                    <>
                        <select
                            aria-label="Filter by rank"
                            value={rank}
                            onChange={(e) => setRank(e.target.value)}
                            className="h-9 rounded-lg border border-[color:var(--input)] bg-[color:var(--card)] px-2 text-sm"
                        >
                            <option value="">All ranks</option>
                            {[...APPOINTABLE, 'CEO' as Rank, 'SUPER_ADMIN' as Rank].map((r) => (
                                <option key={r} value={r}>
                                    {RANK_LABEL[r]}
                                </option>
                            ))}
                        </select>
                        <FilterChips
                            label="Filter by account status"
                            value={status}
                            onChange={setStatus}
                            options={[
                                { value: '', label: 'All' },
                                { value: 'active', label: 'Active' },
                                {
                                    value: 'inactive',
                                    label: 'Deactivated',
                                    count: staff.filter((u) => !u.isActive).length,
                                },
                            ]}
                        />
                    </>
                }
                actions={
                    <Button size="sm" onClick={() => setAppointing(true)}>
                        <UserPlus />
                        Appoint
                    </Button>
                }
            />

            <DataTable
                rows={rows}
                columns={columns}
                getRowId={(u) => u.id}
                search={search}
                linkFor={(u) => `/admin/console/staff/${u.id}`}
                rowTone={(u) => (u.isActive ? null : 'muted')}
                empty="Nobody matches this view."
                footnote={`${total} on the establishment · open a name for their service record`}
            />

            {appointing && (
                <AppointDrawer
                    departments={departments}
                    geography={geography}
                    onClose={() => setAppointing(false)}
                    onSaved={() => {
                        setAppointing(false)
                        router.refresh()
                    }}
                />
            )}
        </div>
    )
}
