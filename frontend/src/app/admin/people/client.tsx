'use client'

import { useEffect, useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2, UserPlus } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Panel } from '@/components/shared/surface'
import { FilterChips, Toolbar } from '@/components/shared/controls'
import { DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { ErrorBanner, SectionHeading } from '@/components/shared/page-header'
import { RANK_LABEL, RANK_LEVEL, RANK_STYLE, TRADE_LABEL } from '@/lib/constants'
import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Department, GeographyTree, Rank, Trade, User } from '@/types'

/** Ranks the Super Admin can appoint, from the top down. */
const APPOINTABLE: Rank[] = [
    'HOD',
    'ZONAL_OFFICER',
    'CIRCLE_OFFICER',
    'SECTION_OFFICER',
    'FIELD_WORKER',
]

/** What geography each rank must be posted to, mirroring RANK_JURISDICTION. */
const NEEDS: Record<string, 'zone' | 'circle' | 'sector' | 'none'> = {
    HOD: 'none',
    ZONAL_OFFICER: 'zone',
    CIRCLE_OFFICER: 'circle',
    SECTION_OFFICER: 'sector',
    FIELD_WORKER: 'sector',
}

/** Where a posting sits, in the words the authority uses. */
function placeOf(user: User): string | null {
    const p = user.primaryPosting
    if (!p) {
        return user.homeSector ? `Sector ${user.homeSector.number}` : null
    }
    if (p.sector) return `Sector ${p.sector.number}`
    return p.circle?.name ?? p.zone?.name ?? null
}

function AppointForm({
    departments,
    geography,
    onDone,
    onCancel,
}: {
    departments: Department[]
    geography: GeographyTree[]
    onDone: () => void
    onCancel: () => void
}) {
    const [form, setForm] = useState({
        fullName: '',
        email: '',
        password: '',
        rank: 'SECTION_OFFICER' as Rank,
        departmentId: '',
        zoneId: '',
        circleId: '',
        sectorId: '',
        trade: '' as Trade | '',
    })
    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)

    const update = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
    const needs = NEEDS[form.rank] ?? 'none'

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSubmitting(true)
        setError(null)
        try {
            await apiClient.createStaff({
                fullName: form.fullName,
                email: form.email,
                password: form.password,
                rank: form.rank,
                departmentId: form.departmentId ? Number(form.departmentId) : null,
                zoneId: needs === 'zone' && form.zoneId ? Number(form.zoneId) : null,
                circleId: needs === 'circle' && form.circleId ? Number(form.circleId) : null,
                sectorId: needs === 'sector' && form.sectorId ? Number(form.sectorId) : null,
                trade: form.rank === 'FIELD_WORKER' && form.trade ? form.trade : null,
            })
            onDone()
        } catch (err) {
            setError(messageFrom(err, 'Could not create this posting.'))
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Panel className="mb-5">
            <form onSubmit={submit} className="space-y-4">
                <SectionHeading
                    title="Appoint someone to a post"
                    description="A person and their posting are created together — someone without a posting is not on the org chart and receives no work."
                />

                {error && <ErrorBanner message={error} />}

                <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="fullName">Full name</Label>
                        <Input
                            id="fullName"
                            required
                            minLength={2}
                            value={form.fullName}
                            onChange={(e) => update('fullName', e.target.value)}
                        />
                    </div>

                    <div>
                        <Label htmlFor="email">Official email</Label>
                        <Input
                            id="email"
                            type="email"
                            required
                            placeholder="name@noidaauthority.in"
                            value={form.email}
                            onChange={(e) => update('email', e.target.value)}
                        />
                    </div>

                    <div>
                        <Label htmlFor="password">Temporary password</Label>
                        <Input
                            id="password"
                            type="text"
                            required
                            minLength={8}
                            placeholder="At least 8 characters"
                            value={form.password}
                            onChange={(e) => update('password', e.target.value)}
                        />
                    </div>

                    <div>
                        <Label htmlFor="rank">Post</Label>
                        <Select id="rank" value={form.rank} onChange={(e) => update('rank', e.target.value)}>
                            {APPOINTABLE.map((r) => (
                                <option key={r} value={r}>
                                    {RANK_LABEL[r]}
                                </option>
                            ))}
                        </Select>
                    </div>

                    <div>
                        <Label htmlFor="departmentId">Department</Label>
                        <Select
                            id="departmentId"
                            required
                            value={form.departmentId}
                            onChange={(e) => update('departmentId', e.target.value)}
                        >
                            <option value="">Select a department</option>
                            {departments.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.icon} {d.name}
                                    {d.status === 'COMING_SOON' ? ' (not live yet)' : ''}
                                </option>
                            ))}
                        </Select>
                    </div>

                    {needs === 'zone' && (
                        <div>
                            <Label htmlFor="zoneId">Zone</Label>
                            <Select
                                id="zoneId"
                                required
                                value={form.zoneId}
                                onChange={(e) => update('zoneId', e.target.value)}
                            >
                                <option value="">Select a zone</option>
                                {geography.map((z) => (
                                    <option key={z.id} value={z.id}>
                                        {z.name}
                                    </option>
                                ))}
                            </Select>
                        </div>
                    )}

                    {needs === 'circle' && (
                        <div>
                            <Label htmlFor="circleId">Work circle</Label>
                            <Select
                                id="circleId"
                                required
                                value={form.circleId}
                                onChange={(e) => update('circleId', e.target.value)}
                            >
                                <option value="">Select a circle</option>
                                {geography.map((z) => (
                                    <optgroup key={z.id} label={z.name}>
                                        {z.circles.map((c) => (
                                            <option key={c.id} value={c.id}>
                                                {c.name}
                                            </option>
                                        ))}
                                    </optgroup>
                                ))}
                            </Select>
                        </div>
                    )}

                    {needs === 'sector' && (
                        <div>
                            <Label htmlFor="sectorId">Sector</Label>
                            <Select
                                id="sectorId"
                                required
                                value={form.sectorId}
                                onChange={(e) => update('sectorId', e.target.value)}
                            >
                                <option value="">Select a sector</option>
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
                            </Select>
                        </div>
                    )}

                    {form.rank === 'FIELD_WORKER' && (
                        <div>
                            <Label htmlFor="trade">Trade</Label>
                            <Select
                                id="trade"
                                required
                                value={form.trade}
                                onChange={(e) => update('trade', e.target.value)}
                            >
                                <option value="">Select a trade</option>
                                {Object.entries(TRADE_LABEL).map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </Select>
                            <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                                Determines which jobs their officer can allot to them.
                            </p>
                        </div>
                    )}
                </div>

                <div className="flex gap-2">
                    <Button type="submit" disabled={submitting}>
                        {submitting && <Loader2 className="animate-spin" />}
                        Create posting
                    </Button>
                    <Button type="button" variant="outline" onClick={onCancel}>
                        Cancel
                    </Button>
                </div>
            </form>
        </Panel>
    )
}

/**
 * The rolls of the authority.
 *
 * Rows rather than list items, because every question asked here is a
 * comparison down a column: who is posted where, who is carrying nothing, which
 * accounts are switched off. Searching and rank filtering stay on the server —
 * this list is the whole authority, not one page of it — while sorting is
 * local so a column can be reordered without a round trip.
 */
export function PeopleClient({
    people,
    total,
    departments,
    geography,
    currentUserId,
    filters,
}: {
    people: User[]
    total: number
    departments: Department[]
    geography: GeographyTree[]
    currentUserId: number
    filters: { rank: string; q: string }
}) {
    const router = useRouter()
    const pathname = usePathname()
    const [, startTransition] = useTransition()
    const [creating, setCreating] = useState(false)
    const [search, setSearch] = useState(filters.q)
    const [busyId, setBusyId] = useState<number | null>(null)
    const [error, setError] = useState<string | null>(null)

    function apply(next: Partial<{ rank: string; q: string }>) {
        const params = new URLSearchParams()
        const merged = { ...filters, ...next }
        if (merged.rank) params.set('rank', merged.rank)
        if (merged.q) params.set('q', merged.q)
        startTransition(() => router.push(`${pathname}?${params}`))
    }

    useEffect(() => {
        if (search === filters.q) return
        const timer = setTimeout(() => apply({ q: search }), 400)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search])

    async function toggleActive(target: User) {
        setBusyId(target.id)
        setError(null)
        try {
            await apiClient.updateUser(target.id, { isActive: !target.isActive })
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not update this account.'))
        } finally {
            setBusyId(null)
        }
    }

    const columns: Column<User>[] = [
        {
            key: 'name',
            header: 'Name',
            value: (u) => `${u.fullName} ${u.email}`,
            cell: (u) => (
                <div className="flex items-center gap-3">
                    <span
                        className={cn(
                            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
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
            // Sorted by seniority, not alphabetically: "who is senior here" is
            // the question, and an alphabetical rank column answers nothing.
            value: (u) => RANK_LEVEL[u.rank],
            cell: (u) => (
                <Badge className={RANK_STYLE[u.rank]}>
                    {u.primaryPosting?.designationTitle ?? RANK_LABEL[u.rank]}
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
                    <span className="text-xs">
                        {u.primaryPosting.department.icon} {u.primaryPosting.department.name}
                    </span>
                ) : (
                    <span className="text-[color:var(--subtle-foreground)]">—</span>
                ),
        },
        {
            key: 'place',
            header: 'Charge',
            value: (u) => placeOf(u),
            cell: (u) => (
                <span className="text-xs">
                    {placeOf(u) ?? <span className="text-[color:var(--subtle-foreground)]">—</span>}
                </span>
            ),
        },
        {
            key: 'code',
            header: 'Employee no.',
            secondary: true,
            value: (u) => u.primaryPosting?.employeeCode ?? null,
            cell: (u) =>
                u.primaryPosting?.employeeCode ? (
                    <Mono>{u.primaryPosting.employeeCode}</Mono>
                ) : (
                    <span className="text-[color:var(--subtle-foreground)]">—</span>
                ),
        },
        {
            key: 'status',
            header: 'Account',
            value: (u) => (u.isActive ? 'Active' : 'Inactive'),
            cell: (u) =>
                u.isActive ? (
                    <Badge variant="success">Active</Badge>
                ) : (
                    <Badge variant="danger">Inactive</Badge>
                ),
        },
        {
            key: 'actions',
            header: '',
            align: 'right',
            width: 'w-32',
            cell: (u) =>
                u.id === currentUserId ? (
                    <span className="text-xs text-[color:var(--subtle-foreground)]">You</span>
                ) : (
                    <Button
                        size="sm"
                        variant={u.isActive ? 'outline' : 'default'}
                        onClick={() => void toggleActive(u)}
                        disabled={busyId === u.id}
                    >
                        {busyId === u.id && <Loader2 className="animate-spin" />}
                        {u.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                ),
        },
    ]

    return (
        <div>
            {error && <ErrorBanner message={error} />}

            {creating && (
                <AppointForm
                    departments={departments}
                    geography={geography}
                    onCancel={() => setCreating(false)}
                    onDone={() => {
                        setCreating(false)
                        router.refresh()
                    }}
                />
            )}

            <Toolbar
                search={search}
                onSearch={setSearch}
                placeholder="Search by name or email"
                actions={
                    !creating && (
                        <Button onClick={() => setCreating(true)}>
                            <UserPlus />
                            Appoint someone
                        </Button>
                    )
                }
            />

            <FilterChips
                label="Filter by post"
                className="mb-4"
                value={filters.rank}
                onChange={(rank) => apply({ rank })}
                options={[
                    { value: '', label: 'Everyone' },
                    ...APPOINTABLE.map((r) => ({ value: r, label: RANK_LABEL[r] })),
                    { value: 'CITIZEN', label: RANK_LABEL.CITIZEN },
                ]}
            />

            <DataTable
                rows={people}
                columns={columns}
                getRowId={(u) => u.id}
                initialSort={{ key: 'post', direction: 'desc' }}
                rowTone={(u) => (u.isActive ? null : 'muted')}
                empty="Nobody matches this filter."
                footnote={
                    people.length < total
                        ? `Showing ${people.length} of ${total} on the rolls.`
                        : `${total} ${total === 1 ? 'person' : 'people'} on the rolls.`
                }
            />
        </div>
    )
}
