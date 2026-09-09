'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Pencil, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Count, DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { NothingHere, RecordHeader, RecordTabs, TableCaption, Trail } from '@/components/console/detail'
import { ComplaintsTable, RosterTable } from '@/components/console/tables'
import { RANK_STYLE, TRADE_LABEL } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { ConsoleComplaint, DepartmentDetail } from '@/types'
import { CategoryEditor, DepartmentEditor, DesignationEditor } from '../../editors'
import type { DepartmentCategory, DesignationShape } from '../../editors'

/**
 * One department, whole.
 *
 * Its chain of command, the titles that chain uses, what the public may report
 * to it, who works in it and what it is building — previously five screens the
 * reader had to join up themselves. A department is the unit a General Manager
 * actually runs, so it is the unit the console presents.
 */
export function DepartmentClient({
    detail,
    tab,
    complaints,
}: {
    detail: DepartmentDetail
    tab: string
    complaints: ConsoleComplaint[]
}) {
    const router = useRouter()
    const { department, tiers, designations, categories, staff } = detail

    const [editing, setEditing] = useState(false)
    const [openDesignation, setOpenDesignation] = useState<DesignationShape | null>(null)
    const [creatingDesignation, setCreatingDesignation] = useState(false)
    const [openCategory, setOpenCategory] = useState<DepartmentCategory | null>(null)
    const [creatingCategory, setCreatingCategory] = useState(false)

    const base = `/admin/console/departments/${department.id}`
    const refresh = () => {
        setEditing(false)
        setOpenDesignation(null)
        setCreatingDesignation(false)
        setOpenCategory(null)
        setCreatingCategory(false)
        router.refresh()
    }

    const designationColumns: Column<DesignationShape>[] = [
        {
            key: 'rank',
            header: 'Rank',
            value: (d) => d.rankLabel,
            cell: (d) => <span className="text-xs">{d.rankLabel}</span>,
        },
        {
            key: 'title',
            header: 'Called here',
            value: (d) => d.title,
            cell: (d) => <RowTitle hint={d.titleHi ?? undefined}>{d.title}</RowTitle>,
        },
        {
            key: 'short',
            header: 'Short',
            width: 'w-24',
            value: (d) => d.shortTitle,
            cell: (d) =>
                d.shortTitle ? <Mono>{d.shortTitle}</Mono> : <span className="opacity-40">—</span>,
        },
        {
            key: 'holders',
            header: 'Holding it',
            align: 'right',
            value: (d) => d.holders,
            cell: (d) => <Count value={d.holders} />,
        },
    ]

    const categoryColumns: Column<DepartmentCategory>[] = [
        {
            key: 'name',
            header: 'Category',
            value: (c) => `${c.name} ${c.keywords}`,
            cell: (c) => (
                <div className="flex items-center gap-2.5">
                    <span aria-hidden>{c.icon}</span>
                    <RowTitle hint={c.nameHi ?? c.code}>{c.name}</RowTitle>
                </div>
            ),
        },
        {
            key: 'sla',
            header: 'Deadline',
            align: 'right',
            value: (c) => c.defaultSlaHours,
            cell: (c) => <span className="tnum text-xs">{c.defaultSlaHours}h</span>,
        },
        {
            key: 'trade',
            header: 'Trade',
            secondary: true,
            value: (c) => (c.trade ? TRADE_LABEL[c.trade] : null),
            cell: (c) =>
                c.trade ? (
                    <span className="text-xs">{TRADE_LABEL[c.trade]}</span>
                ) : (
                    <span className="opacity-40">Any</span>
                ),
        },
        {
            key: 'active',
            header: 'Filing',
            value: (c) => (c.isActive ? 'Open' : 'Closed'),
            cell: (c) =>
                c.isActive ? (
                    <Badge variant="success">Open</Badge>
                ) : (
                    <Badge variant="neutral">Closed</Badge>
                ),
        },
        {
            key: 'filed',
            header: 'Filed',
            align: 'right',
            value: (c) => c.complaintCount,
            cell: (c) => <Count value={c.complaintCount} />,
        },
    ]

    return (
        <div>
            <Trail
                items={[
                    { label: 'Departments', href: '/admin/console/departments' },
                    { label: department.name },
                ]}
            />

            <RecordHeader
                icon={department.icon}
                title={department.name}
                subtitle={department.description ?? department.nameHi ?? department.code}
                badges={
                    department.status === 'ACTIVE' ? (
                        <Badge variant="success">Live</Badge>
                    ) : (
                        <Badge variant="neutral">On the roadmap</Badge>
                    )
                }
                actions={
                    <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
                        <Pencil />
                        Edit department
                    </Button>
                }
                stats={[
                    { label: 'Staff', value: staff.length },
                    { label: 'Categories', value: categories.length },
                    {
                        label: 'Open complaints',
                        value: detail.complaints.open,
                        href: `/admin/console/complaints?departmentId=${department.id}`,
                    },
                    {
                        label: 'Past deadline',
                        value: detail.complaints.overdue,
                        tone: detail.complaints.overdue > 0 ? 'danger' : undefined,
                    },
                ]}
            />

            <RecordTabs
                basePath={base}
                active={tab}
                tabs={[
                    { key: 'chain', label: 'Chain of command' },
                    { key: 'staff', label: 'Staff', count: staff.length },
                    { key: 'categories', label: 'What can be reported', count: categories.length },
                    { key: 'complaints', label: 'Complaints', count: detail.complaints.total },
                ]}
            />

            {tab === 'chain' && (
                <div className="space-y-8">
                    <section>
                        <TableCaption
                            title="The ladder in this department"
                            hint="A complaint enters at the Section Officer and escalates upward one tier at a time. Ranks with nobody in them break that chain."
                        />
                        <ol className="space-y-2">
                            {tiers.length === 0 && (
                                <NothingHere>
                                    Nobody is posted to this department yet, so it has no chain of
                                    command. Appoint staff from the staff register.
                                </NothingHere>
                            )}
                            {tiers.map((tier, index) => (
                                <li
                                    key={tier.rank}
                                    className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] px-4 py-3"
                                    style={{ marginLeft: `${Math.min(index, 4) * 16}px` }}
                                >
                                    <Badge className={RANK_STYLE[tier.rank]}>{tier.designation}</Badge>
                                    <span className="text-xs text-[color:var(--muted-foreground)]">
                                        {tier.rankLabel}
                                    </span>
                                    <span
                                        className={cn(
                                            'tnum ml-auto text-sm font-semibold',
                                            tier.count === 0 && 'text-[color:var(--error)]',
                                        )}
                                    >
                                        {tier.count} {tier.count === 1 ? 'person' : 'people'}
                                    </span>
                                </li>
                            ))}
                        </ol>
                    </section>

                    <section>
                        <TableCaption
                            title="What each rank is called here"
                            hint="A Junior Engineer in Civil is a Sanitary Inspector in Public Health. Renaming an occupied post updates everyone holding it."
                            action={
                                <Button size="sm" onClick={() => setCreatingDesignation(true)}>
                                    <Plus />
                                    Name a post
                                </Button>
                            }
                        />
                        <DataTable
                            rows={designations}
                            columns={designationColumns}
                            getRowId={(d) => d.id}
                            onRowClick={setOpenDesignation}
                            activeId={openDesignation?.id ?? null}
                            empty="No posts named yet — ranks fall back to their generic label."
                        />
                    </section>
                </div>
            )}

            {tab === 'staff' && (
                <section>
                    <TableCaption
                        title={`Everyone in ${department.name}`}
                        hint="Across every zone, circle and sector."
                    />
                    <RosterTable staff={staff} showDepartment={false} />
                </section>
            )}

            {tab === 'categories' && (
                <section>
                    <TableCaption
                        title="What the public may report to this department"
                        hint="Each category carries the deadline GCCE stamps on a complaint and the keywords it matches a citizen's words against."
                        action={
                            <Button size="sm" onClick={() => setCreatingCategory(true)}>
                                <Plus />
                                New category
                            </Button>
                        }
                    />
                    <DataTable
                        rows={categories}
                        columns={categoryColumns}
                        getRowId={(c) => c.id}
                        onRowClick={setOpenCategory}
                        activeId={openCategory?.id ?? null}
                        rowTone={(c) => (c.isActive ? null : 'muted')}
                        empty="Nothing can be reported to this department yet."
                    />
                </section>
            )}

            {tab === 'complaints' && (
                <section>
                    <TableCaption title={`Complaints routed to ${department.name}`} />
                    <ComplaintsTable
                        complaints={complaints}
                        emptyText="Nothing has been routed to this department."
                    />
                </section>
            )}


            {editing && (
                <DepartmentEditor department={department} onClose={() => setEditing(false)} onSaved={refresh} />
            )}

            {(openDesignation || creatingDesignation) && (
                <DesignationEditor
                    designation={openDesignation}
                    departmentId={department.id}
                    departmentName={department.name}
                    onClose={() => {
                        setOpenDesignation(null)
                        setCreatingDesignation(false)
                    }}
                    onSaved={refresh}
                />
            )}

            {(openCategory || creatingCategory) && (
                <CategoryEditor
                    category={openCategory}
                    departmentId={department.id}
                    departmentName={department.name}
                    onClose={() => {
                        setOpenCategory(null)
                        setCreatingCategory(false)
                    }}
                    onSaved={refresh}
                />
            )}
        </div>
    )
}
