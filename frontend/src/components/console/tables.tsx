'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { Toolbar } from '@/components/console/toolbar'
import { PRIORITY_META, RANK_STYLE, STATUS_META, TRADE_LABEL } from '@/lib/constants'
import { deadlineLabel, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ConsoleComplaint, RosterRow } from '@/types'

/**
 * Tables that appear inside more than one record page.
 *
 * A sector, a circle, a zone and a department all answer "who works here" and
 * "what has been reported here". Rendering those the same way everywhere is
 * what makes the console feel like one system rather than six screens that
 * happen to share a sidebar.
 */

const CLOSED_STATUSES = ['RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE']

/** Who covers this ground, and what each of them is carrying. */
export function RosterTable({
    staff,
    caption = 'Search this roster',
    showDepartment = true,
}: {
    staff: RosterRow[]
    caption?: string
    showDepartment?: boolean
}) {
    const [search, setSearch] = useState('')

    const columns: Column<RosterRow>[] = [
        {
            key: 'name',
            header: 'Name',
            value: (r) => `${r.fullName} ${r.email}`,
            cell: (r) => (
                <Link
                    href={`/admin/console/staff/${r.userId}`}
                    className="hover:underline"
                    onClick={(e) => e.stopPropagation()}
                >
                    <RowTitle hint={r.email}>
                        <span className={cn(!r.isActive && 'line-through opacity-60')}>
                            {r.fullName}
                        </span>
                    </RowTitle>
                </Link>
            ),
        },
        {
            key: 'post',
            header: 'Post',
            value: (r) => r.designationTitle,
            cell: (r) => <Badge className={RANK_STYLE[r.rank]}>{r.designationTitle}</Badge>,
        },
        ...(showDepartment
            ? ([
                  {
                      key: 'department',
                      header: 'Department',
                      secondary: true,
                      value: (r: RosterRow) => r.department?.name ?? null,
                      cell: (r: RosterRow) =>
                          r.department ? (
                              <Link
                                  href={`/admin/console/departments/${r.department.id}`}
                                  className="text-xs text-[color:var(--muted-foreground)] hover:underline"
                              >
                                  {r.department.icon} {r.department.name}
                              </Link>
                          ) : (
                              <span className="opacity-40">—</span>
                          ),
                  },
              ] as Column<RosterRow>[])
            : []),
        {
            key: 'charge',
            header: 'Charge',
            value: (r) => r.jurisdictionLabel,
            cell: (r) => <span className="text-xs">{r.jurisdictionLabel}</span>,
        },
        {
            key: 'trade',
            header: 'Trade',
            secondary: true,
            value: (r) => (r.trade ? TRADE_LABEL[r.trade] : null),
            cell: (r) =>
                r.trade ? (
                    <span className="text-xs">{TRADE_LABEL[r.trade]}</span>
                ) : (
                    <span className="opacity-40">—</span>
                ),
        },
        {
            key: 'open',
            header: 'Open cases',
            align: 'right',
            value: (r) => r.openCases,
            cell: (r) => (
                <span className={cn('tnum', r.openCases >= 8 && 'font-semibold text-[color:var(--error)]')}>
                    {r.openCases === 0 ? <span className="opacity-40">—</span> : r.openCases}
                </span>
            ),
        },
    ]

    return (
        <>
            <Toolbar search={search} onSearch={setSearch} placeholder={caption} />
            <DataTable
                rows={staff}
                columns={columns}
                getRowId={(r) => r.postingId}
                search={search}
                rowTone={(r) => (r.isActive ? null : 'muted')}
                empty="Nobody is posted here. Complaints arriving here will route to nobody."
                footnote="Click a name to open their service record."
            />
        </>
    )
}

/** What has been reported here. Rows link into the complaint desk. */
export function ComplaintsTable({
    complaints,
    emptyText = 'Nothing has been reported here.',
    showSector = true,
}: {
    complaints: ConsoleComplaint[]
    emptyText?: string
    showSector?: boolean
}) {
    const [search, setSearch] = useState('')

    const columns: Column<ConsoleComplaint>[] = [
        {
            key: 'ref',
            header: 'Reference',
            width: 'w-36',
            value: (c) => c.referenceNo,
            cell: (c) => <Mono>{c.referenceNo}</Mono>,
        },
        {
            key: 'title',
            header: 'Complaint',
            value: (c) => `${c.title} ${c.description}`,
            cell: (c) => (
                <div className="flex items-center gap-2">
                    {c.category && <span aria-hidden>{c.category.icon}</span>}
                    <RowTitle
                        hint={
                            showSector && c.sector
                                ? `Sector ${c.sector.number} · ${c.department?.name ?? 'Unrouted'}`
                                : (c.department?.name ?? 'Unrouted')
                        }
                    >
                        {c.title}
                    </RowTitle>
                </div>
            ),
        },
        {
            key: 'status',
            header: 'Status',
            value: (c) => STATUS_META[c.status].label,
            cell: (c) => (
                <Badge className={STATUS_META[c.status].className}>{STATUS_META[c.status].label}</Badge>
            ),
        },
        {
            key: 'priority',
            header: 'Priority',
            secondary: true,
            value: (c) => c.priority,
            cell: (c) => (
                <Badge className={PRIORITY_META[c.priority].className}>
                    {PRIORITY_META[c.priority].label}
                </Badge>
            ),
        },
        {
            key: 'owner',
            header: 'Owner',
            value: (c) => c.assignedOfficer?.fullName ?? null,
            cell: (c) =>
                c.assignedOfficer ? (
                    <Link
                        href={`/admin/console/staff/${c.assignedOfficer.id}`}
                        className="text-xs hover:underline"
                    >
                        {c.assignedOfficer.fullName}
                    </Link>
                ) : (
                    <Badge variant="danger">Nobody</Badge>
                ),
        },
        {
            key: 'deadline',
            header: 'Deadline',
            align: 'right',
            value: (c) => (c.slaDueAt ? new Date(c.slaDueAt).getTime() : null),
            cell: (c) => {
                const d = deadlineLabel(c.slaDueAt, !CLOSED_STATUSES.includes(c.status))
                return (
                    <span
                        className={cn(
                            'text-xs',
                            d.tone === 'overdue' && 'font-semibold text-[color:var(--error)]',
                            d.tone === 'urgent' && 'font-medium text-[color:var(--warning-fg)]',
                        )}
                    >
                        {d.text}
                    </span>
                )
            },
        },
        {
            key: 'filed',
            header: 'Filed',
            align: 'right',
            secondary: true,
            value: (c) => new Date(c.createdAt).getTime(),
            cell: (c) => (
                <span className="text-xs text-[color:var(--muted-foreground)]">
                    {relativeTime(c.createdAt)}
                </span>
            ),
        },
    ]

    return (
        <>
            <Toolbar search={search} onSearch={setSearch} placeholder="Search these complaints" />
            <DataTable
                rows={complaints}
                columns={columns}
                getRowId={(c) => c.id}
                search={search}
                initialSort={{ key: 'filed', direction: 'desc' }}
                rowTone={(c) =>
                    !c.assignedOfficer && !CLOSED_STATUSES.includes(c.status)
                        ? 'danger'
                        : c.isOverdue
                          ? 'warning'
                          : null
                }
                empty={emptyText}
                footnote="Red rows have no owner. Amber rows are past deadline."
            />
        </>
    )
}
