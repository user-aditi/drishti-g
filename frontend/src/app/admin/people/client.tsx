'use client'

import { useEffect, useState, useTransition } from 'react'
import type { FormEvent } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Loader2, UserPlus } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
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
        <Card className="mb-5 p-5">
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
        </Card>
    )
}

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

    return (
        <div>
            {!creating && (
                <div className="mb-5 flex justify-end">
                    <Button onClick={() => setCreating(true)}>
                        <UserPlus />
                        Appoint someone
                    </Button>
                </div>
            )}

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

            {error && <ErrorBanner message={error} />}

            <Card className="mb-4 space-y-3 p-5">
                <Input
                    placeholder="Search by name or email"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                />
                <div className="flex flex-wrap gap-1.5">
                    {(['', ...APPOINTABLE, 'CITIZEN'] as (Rank | '')[]).map((r) => (
                        <button
                            key={r || 'all'}
                            onClick={() => apply({ rank: r })}
                            className={cn(
                                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                                filters.rank === r
                                    ? 'bg-[color:var(--primary)] text-white'
                                    : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)] hover:bg-slate-200',
                            )}
                        >
                            {r === '' ? 'Everyone' : RANK_LABEL[r]}
                        </button>
                    ))}
                </div>
            </Card>

            <Card className="overflow-hidden">
                <ul className="divide-y divide-[color:var(--border)]">
                    {[...people]
                        .sort((a, b) => RANK_LEVEL[b.rank] - RANK_LEVEL[a.rank])
                        .map((u) => {
                            const p = u.primaryPosting
                            return (
                                <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                                    <div
                                        className={cn(
                                            'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                                            u.isActive
                                                ? 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]'
                                                : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]',
                                        )}
                                    >
                                        {initials(u.fullName)}
                                    </div>

                                    <div className="min-w-0 flex-1">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span
                                                className={cn(
                                                    'truncate text-sm font-medium',
                                                    !u.isActive &&
                                                        'text-[color:var(--muted-foreground)] line-through',
                                                )}
                                            >
                                                {u.fullName}
                                            </span>
                                            <Badge className={RANK_STYLE[u.rank]}>
                                                {p?.designationTitle ?? RANK_LABEL[u.rank]}
                                            </Badge>
                                            {!u.isActive && <Badge variant="danger">Inactive</Badge>}
                                        </div>
                                        <p className="truncate text-xs text-[color:var(--muted-foreground)]">
                                            {u.email}
                                            {p?.department && ` · ${p.department.name}`}
                                            {p?.sector
                                                ? ` · Sector ${p.sector.number}`
                                                : p?.circle
                                                  ? ` · ${p.circle.name}`
                                                  : p?.zone
                                                    ? ` · ${p.zone.name}`
                                                    : ''}
                                            {p?.employeeCode && ` · ${p.employeeCode}`}
                                            {u.rank === 'CITIZEN' &&
                                                u.homeSector &&
                                                ` · Sector ${u.homeSector.number}`}
                                        </p>
                                    </div>

                                    {u.id !== currentUserId && (
                                        <Button
                                            size="sm"
                                            variant={u.isActive ? 'outline' : 'default'}
                                            onClick={() => void toggleActive(u)}
                                            disabled={busyId === u.id}
                                        >
                                            {busyId === u.id && <Loader2 className="animate-spin" />}
                                            {u.isActive ? 'Deactivate' : 'Reactivate'}
                                        </Button>
                                    )}
                                </li>
                            )
                        })}
                </ul>
            </Card>

            <p className="tnum mt-3 text-sm text-[color:var(--muted-foreground)]">
                {total} {total === 1 ? 'person' : 'people'} on the rolls
            </p>
        </div>
    )
}
