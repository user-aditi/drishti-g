'use client'

import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Loader2, PenLine, UserCheck } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/shared/page-header'
import { DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { Drawer, DrawerSection, FactList } from '@/components/console/drawer'
import {
    FormGrid,
    FullWidth,
    NumberField,
    SelectField,
    TextAreaField,
} from '@/components/console/form'
import { FilterChips, Toolbar } from '@/components/console/toolbar'
import { PRIORITY_META, STATUS_META } from '@/lib/constants'
import { deadlineLabel, formatDateTime, relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type {
    AssignCandidate,
    CategoryRow,
    ComplaintStatus,
    ConsoleComplaint,
    Department,
    GeographyTree,
    Priority,
} from '@/types'

const FLAGS = [
    { value: '', label: 'Everything' },
    { value: 'unassigned', label: 'No owner' },
    { value: 'overdue', label: 'Past deadline' },
    { value: 'escalated', label: 'Escalated' },
    { value: 'unrouted', label: 'Unrouted' },
]

/**
 * The complaint desk.
 *
 * GCCE routes correctly nearly every time. This screen exists for the rest —
 * the streetlight filed under Civil, the complaint whose Junior Engineer left,
 * the case that has sat past its deadline with nobody above it noticing. Every
 * override here demands a reason, which lands in the audit trail beside it.
 */
export function ComplaintDeskClient({
    complaints,
    total,
    departments,
    geography,
    categories,
    filters,
}: {
    complaints: ConsoleComplaint[]
    total: number
    departments: Department[]
    geography: GeographyTree[]
    categories: CategoryRow[]
    filters: { flag: string; scopeLabel: string | null }
}) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const [search, setSearch] = useState('')
    const [open, setOpen] = useState<ConsoleComplaint | null>(null)

    /**
     * Flags re-query the server, because they filter the whole register.
     *
     * The scope this page arrived with — a sector, a department — is kept, so
     * "past deadline" narrows what you were already looking at rather than
     * throwing you back to the whole city.
     */
    function applyFlag(flag: string) {
        const next = new URLSearchParams(searchParams.toString())
        if (flag) next.set('flag', flag)
        else next.delete('flag')
        const query = next.toString()
        router.push(query ? `${pathname}?${query}` : pathname)
    }

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
                    {c.category && (
                        <span aria-hidden className="text-base">
                            {c.category.icon}
                        </span>
                    )}
                    <RowTitle
                        hint={
                            c.sector
                                ? `Sector ${c.sector.number} · ${c.department?.name ?? 'No department'}`
                                : 'Not routed to a sector'
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
                    <span className="text-xs">{c.assignedOfficer.fullName}</span>
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
                const d = deadlineLabel(c.slaDueAt, !['RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE'].includes(c.status))
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
        <div>
            <Toolbar
                search={search}
                onSearch={setSearch}
                placeholder="Search by reference, title or description"
                filters={
                    <FilterChips
                        label="Filter by problem"
                        value={filters.flag}
                        onChange={applyFlag}
                        options={FLAGS}
                    />
                }
                actions={
                    filters.scopeLabel ? (
                        <Button size="sm" variant="outline" asChild>
                            <Link href="/admin/console/complaints">
                                Showing {filters.scopeLabel} — clear
                            </Link>
                        </Button>
                    ) : undefined
                }
            />

            <DataTable
                rows={complaints}
                columns={columns}
                getRowId={(c) => c.id}
                search={search}
                activeId={open?.id ?? null}
                onRowClick={setOpen}
                rowTone={(c) =>
                    !c.assignedOfficer && !['RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE'].includes(c.status)
                        ? 'danger'
                        : c.isOverdue
                          ? 'warning'
                          : null
                }
                empty="No complaints match this view."
                footnote={`${total} in the register · red rows have no owner, amber rows are past deadline`}
            />

            {open && (
                <ComplaintRecord
                    complaint={open}
                    departments={departments}
                    geography={geography}
                    categories={categories}
                    onClose={() => setOpen(null)}
                    onChanged={() => {
                        setOpen(null)
                        router.refresh()
                    }}
                />
            )}
        </div>
    )
}

// ---------------------------------------------------------------------------

type Panel = 'assign' | 'correct' | null

function ComplaintRecord({
    complaint,
    departments,
    geography,
    categories,
    onClose,
    onChanged,
}: {
    complaint: ConsoleComplaint
    departments: Department[]
    geography: GeographyTree[]
    categories: CategoryRow[]
    onClose: () => void
    onChanged: () => void
}) {
    const [panel, setPanel] = useState<Panel>(null)

    const stillOpen = !['RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE'].includes(complaint.status)
    const deadline = deadlineLabel(complaint.slaDueAt, stillOpen)

    return (
        <Drawer
            open
            onClose={onClose}
            width="lg"
            title={complaint.title}
            subtitle={`${complaint.referenceNo} · filed ${relativeTime(complaint.createdAt)} by ${complaint.citizen?.fullName ?? 'a citizen'}`}
            badge={
                <>
                    <Badge className={STATUS_META[complaint.status].className}>
                        {STATUS_META[complaint.status].label}
                    </Badge>
                    {complaint.escalationLevel > 0 && (
                        <Badge variant="warning">Escalated ×{complaint.escalationLevel}</Badge>
                    )}
                </>
            }
            footer={
                <>
                    <Button size="sm" onClick={() => setPanel('assign')}>
                        <UserCheck />
                        Assign to an official
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPanel('correct')}>
                        <PenLine />
                        Correct the record
                    </Button>
                    <Button size="sm" variant="ghost" asChild className="ml-auto">
                        <Link href={`/complaints/${complaint.id}`}>Full case file</Link>
                    </Button>
                </>
            }
        >
            <DrawerSection title="What was reported">
                <p className="whitespace-pre-line rounded-lg border border-[color:var(--border)] px-3 py-2.5 text-sm">
                    {complaint.description}
                </p>
            </DrawerSection>

            <DrawerSection title="Where it stands">
                <FactList
                    items={[
                        {
                            label: 'Owner',
                            value: complaint.assignedOfficer ? (
                                complaint.assignedOfficer.fullName
                            ) : (
                                <span className="font-medium text-[color:var(--error)]">
                                    Nobody is accountable for this
                                </span>
                            ),
                        },
                        {
                            label: 'On the job',
                            value: complaint.assignedWorker?.fullName ?? '—',
                        },
                        {
                            label: 'Department',
                            value: complaint.department
                                ? `${complaint.department.icon} ${complaint.department.name}`
                                : 'Not routed',
                        },
                        {
                            label: 'Category',
                            value: complaint.category
                                ? `${complaint.category.icon} ${complaint.category.name}`
                                : 'Not classified',
                        },
                        {
                            label: 'Sector',
                            value: complaint.sector
                                ? `Sector ${complaint.sector.number} — ${complaint.sector.name}`
                                : 'Not routed',
                        },
                        {
                            label: 'Priority',
                            value: (
                                <Badge className={PRIORITY_META[complaint.priority].className}>
                                    {PRIORITY_META[complaint.priority].label}
                                </Badge>
                            ),
                        },
                        {
                            label: 'Deadline',
                            value: (
                                <span
                                    className={cn(
                                        deadline.tone === 'overdue' &&
                                            'font-semibold text-[color:var(--error)]',
                                    )}
                                >
                                    {deadline.text}
                                    {complaint.slaDueAt && (
                                        <span className="ml-2 text-xs text-[color:var(--muted-foreground)]">
                                            {formatDateTime(complaint.slaDueAt)}
                                        </span>
                                    )}
                                </span>
                            ),
                        },
                        {
                            label: 'Location',
                            value: complaint.landmark ?? complaint.address ?? '—',
                        },
                    ]}
                />
            </DrawerSection>

            {panel === 'assign' && (
                <AssignPanel
                    complaint={complaint}
                    onClose={() => setPanel(null)}
                    onSaved={onChanged}
                />
            )}

            {panel === 'correct' && (
                <CorrectPanel
                    complaint={complaint}
                    departments={departments}
                    geography={geography}
                    categories={categories}
                    onClose={() => setPanel(null)}
                    onSaved={onChanged}
                />
            )}
        </Drawer>
    )
}

/**
 * Hand the complaint to a named official.
 *
 * The candidate list is ranked but never filtered down to the "right" answer —
 * the reason to be on this screen at all is that the right answer was wrong. It
 * shows what each person is already carrying, so a fix does not simply move the
 * problem onto someone who is drowning.
 */
function AssignPanel({
    complaint,
    onClose,
    onSaved,
}: {
    complaint: ConsoleComplaint
    onClose: () => void
    onSaved: () => void
}) {
    const [candidates, setCandidates] = useState<AssignCandidate[]>([])
    const [loading, setLoading] = useState(true)
    const [chosen, setChosen] = useState<number | null>(null)
    const [reason, setReason] = useState('')
    const [slaHours, setSlaHours] = useState('')
    const [priority, setPriority] = useState<Priority | ''>('')
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [search, setSearch] = useState('')

    useEffect(() => {
        void (async () => {
            try {
                const res = await apiClient.console.complaints.candidates(complaint.id)
                setCandidates(res.items)
            } catch (err) {
                setError(messageFrom(err, 'Could not load the list of officials.'))
            } finally {
                setLoading(false)
            }
        })()
    }, [complaint.id])

    async function submit(e: FormEvent) {
        e.preventDefault()
        if (chosen == null) return
        setSaving(true)
        setError(null)
        try {
            await apiClient.console.complaints.assign(complaint.id, {
                officerId: chosen,
                reason,
                ...(priority ? { priority } : {}),
                ...(slaHours ? { slaHours: Number(slaHours) } : {}),
            })
            onSaved()
        } catch (err) {
            setError(messageFrom(err, 'Could not reassign this complaint.'))
            setSaving(false)
        }
    }

    const columns: Column<AssignCandidate>[] = [
        {
            key: 'pick',
            header: '',
            width: 'w-10',
            cell: (c) => (
                <input
                    type="radio"
                    name="officer"
                    checked={chosen === c.id}
                    onChange={() => setChosen(c.id)}
                    aria-label={`Assign to ${c.fullName}`}
                    className="h-4 w-4 accent-[color:var(--primary)]"
                />
            ),
        },
        {
            key: 'name',
            header: 'Official',
            value: (c) => `${c.fullName} ${c.designationTitle} ${c.email}`,
            cell: (c) => <RowTitle hint={c.designationTitle}>{c.fullName}</RowTitle>,
        },
        {
            key: 'where',
            header: 'Charge',
            value: (c) => c.jurisdictionLabel,
            cell: (c) => (
                <div className="text-xs">
                    <div>{c.jurisdictionLabel}</div>
                    {c.department && (
                        <div className="text-[color:var(--muted-foreground)]">{c.department.name}</div>
                    )}
                </div>
            ),
        },
        {
            key: 'fit',
            header: 'Why them',
            value: (c) => -c.fit,
            cell: (c) =>
                c.reasons.length === 0 ? (
                    <span className="text-xs opacity-40">Outside this patch</span>
                ) : (
                    <span className="flex flex-wrap gap-1">
                        {c.reasons.map((r) => (
                            <Badge key={r} variant={r.startsWith('Posted') ? 'success' : 'outline'}>
                                {r}
                            </Badge>
                        ))}
                    </span>
                ),
        },
        {
            key: 'load',
            header: 'Carrying',
            align: 'right',
            value: (c) => c.openCases,
            cell: (c) => (
                <span
                    className={cn(
                        'tnum text-xs',
                        c.openCases >= 8 && 'font-semibold text-[color:var(--error)]',
                    )}
                >
                    {c.openCases}
                </span>
            ),
        },
    ]

    return (
        <Drawer
            open
            onClose={onClose}
            width="lg"
            title="Assign to an official"
            subtitle={`${complaint.referenceNo} — currently ${complaint.assignedOfficer?.fullName ?? 'unowned'}`}
            footer={
                <>
                    <Button
                        type="submit"
                        form="assign-form"
                        disabled={saving || chosen == null || reason.trim().length < 3}
                    >
                        {saving && <Loader2 className="animate-spin" />}
                        Assign
                    </Button>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                </>
            }
        >
            {error && <ErrorBanner message={error} />}

            {loading ? (
                <div className="flex items-center gap-2 py-10 text-sm text-[color:var(--muted-foreground)]">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Working out who could take this…
                </div>
            ) : (
                <form id="assign-form" onSubmit={submit}>
                    <DrawerSection
                        title="Who takes it"
                        description="Sorted by how well the posting fits, then by who is carrying least."
                    >
                        <Toolbar
                            search={search}
                            onSearch={setSearch}
                            placeholder="Search officials by name or post"
                        />
                        <DataTable
                            rows={candidates}
                            columns={columns}
                            getRowId={(c) => c.id}
                            search={search}
                            activeId={chosen}
                            onRowClick={(c) => setChosen(c.id)}
                            empty="No officials are available to take this."
                        />
                    </DrawerSection>

                    <DrawerSection title="Why">
                        <FormGrid>
                            <FullWidth>
                                <TextAreaField
                                    id="reason"
                                    label="Reason"
                                    required
                                    rows={2}
                                    minLength={3}
                                    hint="Recorded in the audit trail and sent to both officials. An unexplained reassignment is exactly what an audit looks for."
                                    value={reason}
                                    onChange={setReason}
                                />
                            </FullWidth>
                            <SelectField
                                id="priority"
                                label="Change priority"
                                hint="Leave alone to keep it as it is."
                                value={priority}
                                onChange={(v) => setPriority(v as Priority | '')}
                            >
                                <option value="">Leave unchanged</option>
                                {Object.entries(PRIORITY_META).map(([value, meta]) => (
                                    <option key={value} value={value}>
                                        {meta.label}
                                    </option>
                                ))}
                            </SelectField>
                            <NumberField
                                id="slaHours"
                                label="Reset deadline (hours)"
                                min={1}
                                max={8760}
                                hint="Restarts the clock from now. Leave empty to keep the existing deadline."
                                value={slaHours}
                                onChange={setSlaHours}
                            />
                        </FormGrid>
                    </DrawerSection>
                </form>
            )}
        </Drawer>
    )
}

/** Fix the routing fields GCCE's keyword classifier got wrong. */
function CorrectPanel({
    complaint,
    departments,
    geography,
    categories,
    onClose,
    onSaved,
}: {
    complaint: ConsoleComplaint
    departments: Department[]
    geography: GeographyTree[]
    categories: CategoryRow[]
    onClose: () => void
    onSaved: () => void
}) {
    const [form, setForm] = useState({
        categoryId: complaint.category ? String(complaint.category.id) : '',
        departmentId: complaint.department ? String(complaint.department.id) : '',
        sectorId: complaint.sector ? String(complaint.sector.id) : '',
        priority: complaint.priority as Priority,
        status: complaint.status as ComplaintStatus,
        slaHours: '',
        reason: '',
    })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Picking a category implies its department — leaving the two disagreeing
    // is how a complaint ends up routed somewhere nobody expects.
    function chooseCategory(value: string) {
        const category = categories.find((c) => String(c.id) === value)
        setForm((f) => ({
            ...f,
            categoryId: value,
            departmentId: category ? String(category.departmentId) : f.departmentId,
        }))
    }

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
            await apiClient.console.complaints.correct(complaint.id, {
                categoryId: form.categoryId ? Number(form.categoryId) : null,
                departmentId: form.departmentId ? Number(form.departmentId) : null,
                sectorId: form.sectorId ? Number(form.sectorId) : null,
                priority: form.priority,
                status: form.status,
                ...(form.slaHours ? { slaHours: Number(form.slaHours) } : {}),
                reason: form.reason,
            })
            onSaved()
        } catch (err) {
            setError(messageFrom(err, 'Could not correct this record.'))
            setSaving(false)
        }
    }

    return (
        <Drawer
            open
            onClose={onClose}
            title="Correct the record"
            subtitle={complaint.referenceNo}
            footer={
                <>
                    <Button
                        type="submit"
                        form="correct-form"
                        disabled={saving || form.reason.trim().length < 3}
                    >
                        {saving && <Loader2 className="animate-spin" />}
                        Save correction
                    </Button>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                </>
            }
        >
            {error && <ErrorBanner message={error} />}

            <p className="mb-5 rounded-lg bg-[color:var(--accent)] px-3 py-2.5 text-xs text-[color:var(--accent-foreground)]">
                GCCE classifies on keywords, so a broken streetlight described as a “light problem”
                can land in Civil. Correcting it here is recorded as a correction, which is what
                makes the classifier improvable later.
            </p>

            <form id="correct-form" onSubmit={submit}>
                <DrawerSection title="Routing">
                    <FormGrid>
                        <SelectField
                            id="categoryId"
                            label="Category"
                            hint="Choosing one moves the department to match."
                            value={form.categoryId}
                            onChange={chooseCategory}
                        >
                            <option value="">Not classified</option>
                            {categories.map((c) => (
                                <option key={c.id} value={c.id}>
                                    {c.icon} {c.name} — {c.department.name}
                                </option>
                            ))}
                        </SelectField>
                        <SelectField
                            id="departmentId"
                            label="Department"
                            value={form.departmentId}
                            onChange={(v) => setForm((f) => ({ ...f, departmentId: v }))}
                        >
                            <option value="">Not routed</option>
                            {departments.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.icon} {d.name}
                                </option>
                            ))}
                        </SelectField>
                        <SelectField
                            id="sectorId"
                            label="Sector"
                            hint="Decides which officer's patch this falls in."
                            value={form.sectorId}
                            onChange={(v) => setForm((f) => ({ ...f, sectorId: v }))}
                        >
                            <option value="">Not routed</option>
                            {geography.map((z) =>
                                z.circles.map((c) => (
                                    <optgroup key={c.id} label={`${z.name} · ${c.name}`}>
                                        {c.sectors.map((s) => (
                                            <option key={s.id} value={s.id}>
                                                Sector {s.number} — {s.name}
                                            </option>
                                        ))}
                                    </optgroup>
                                )),
                            )}
                        </SelectField>
                        <SelectField
                            id="priority"
                            label="Priority"
                            value={form.priority}
                            onChange={(v) => setForm((f) => ({ ...f, priority: v as Priority }))}
                        >
                            {Object.entries(PRIORITY_META).map(([value, meta]) => (
                                <option key={value} value={value}>
                                    {meta.label}
                                </option>
                            ))}
                        </SelectField>
                    </FormGrid>
                </DrawerSection>

                <DrawerSection
                    title="State"
                    description="Setting a status by hand bypasses the normal lifecycle. Use it to close a duplicate or reject a complaint that should never have been filed."
                >
                    <FormGrid>
                        <SelectField
                            id="status"
                            label="Status"
                            value={form.status}
                            onChange={(v) => setForm((f) => ({ ...f, status: v as ComplaintStatus }))}
                        >
                            {Object.entries(STATUS_META).map(([value, meta]) => (
                                <option key={value} value={value}>
                                    {meta.label}
                                </option>
                            ))}
                        </SelectField>
                        <NumberField
                            id="slaHours"
                            label="Reset deadline (hours)"
                            min={1}
                            max={8760}
                            hint="Leave empty to keep the existing deadline."
                            value={form.slaHours}
                            onChange={(v) => setForm((f) => ({ ...f, slaHours: v }))}
                        />
                        <FullWidth>
                            <TextAreaField
                                id="reason"
                                label="Reason"
                                required
                                rows={2}
                                minLength={3}
                                hint="Goes into the audit trail and the complaint's own history."
                                value={form.reason}
                                onChange={(v) => setForm((f) => ({ ...f, reason: v }))}
                            />
                        </FullWidth>
                    </FormGrid>
                </DrawerSection>
            </form>
        </Drawer>
    )
}
