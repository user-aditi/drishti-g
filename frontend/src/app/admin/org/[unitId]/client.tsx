'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Count, DataTable, Mono, RowTitle, type Column } from '@/components/shared/data-table'
import { NothingHere, RecordHeader, TableCaption } from '@/components/console/detail'
import { Toolbar } from '@/components/console/toolbar'
import { apiClient } from '@/lib/api-client'
import type { OrgUnitDetail, OrgUnitSummary } from '@/types'

/**
 * A unit of the authority, rendered the same way at every depth.
 *
 * The screen answers the six questions the layer contract promises — what is
 * inside this, who is posted here, how much work is here, how much has gone
 * wrong, where does it escalate to, and can it dispatch — and it answers them
 * identically whether you are looking at a sector or the whole city.
 */
export function UnitClient({ detail }: { detail: OrgUnitDetail }) {
    const router = useRouter()
    const { unit, stats, children, roster, removal, parent } = detail

    const [search, setSearch] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [adding, setAdding] = useState(false)

    const childKind = children[0]?.kindLabel ?? 'unit'

    const columns: Column<OrgUnitSummary>[] = [
        {
            key: 'name',
            header: childKind,
            cell: (r) => <RowTitle hint={r.isLeaf ? 'ground floor' : `${r.kindLabel}`}>{r.name}</RowTitle>,
            value: (r) => r.name,
        },
        {
            key: 'code',
            header: 'Code',
            cell: (r) => <Mono>{r.code}</Mono>,
            value: (r) => r.code,
            secondary: true,
            width: 'w-28',
        },
        {
            key: 'open',
            header: 'Open',
            align: 'right',
            cell: (r) => <Count value={r.stats.open} />,
            value: (r) => r.stats.open,
            width: 'w-20',
        },
        {
            key: 'overdue',
            header: 'Overdue',
            align: 'right',
            cell: (r) => (
                <span className={r.stats.overdue > 0 ? 'font-semibold text-[color:var(--error)]' : ''}>
                    {r.stats.overdue}
                </span>
            ),
            value: (r) => r.stats.overdue,
            width: 'w-24',
        },
        {
            key: 'officers',
            header: 'Officers',
            align: 'right',
            cell: (r) => (
                <span className={r.stats.officers === 0 ? 'font-semibold text-[color:var(--warning-fg)]' : ''}>
                    {r.stats.officers === 0 ? 'none' : r.stats.officers}
                </span>
            ),
            value: (r) => r.stats.officers,
            secondary: true,
            width: 'w-24',
        },
        {
            key: 'crew',
            header: 'Crew',
            align: 'right',
            cell: (r) => <Count value={r.stats.crew} />,
            value: (r) => r.stats.crew,
            secondary: true,
            width: 'w-20',
        },
    ]

    async function addChild(form: FormData) {
        setBusy(true)
        setError(null)
        try {
            const created = await apiClient.org.createUnit({
                parentId: unit.id,
                code: String(form.get('code') ?? '')
                    .toUpperCase()
                    .trim(),
                name: String(form.get('name') ?? '').trim(),
                kindLabel: String(form.get('kindLabel') ?? '').trim() || undefined,
            })
            setAdding(false)
            router.push(`/admin/org/${created.unit.id}`)
            router.refresh()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not add that unit')
        } finally {
            setBusy(false)
        }
    }

    async function removeUnit() {
        if (!confirm(`Remove ${unit.name}? This cannot be undone.`)) return
        setBusy(true)
        setError(null)
        try {
            await apiClient.org.removeUnit(unit.id)
            router.push(parent ? `/admin/org/${parent.id}` : '/admin/org')
            router.refresh()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not remove that unit')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div>
            <RecordHeader
                title={unit.name}
                subtitle={
                    <>
                        {unit.kindLabel} · depth {unit.depth}
                        {parent ? (
                            <>
                                {' '}
                                · escalates to{' '}
                                <a className="underline" href={`/admin/org/${parent.id}`}>
                                    {parent.name}
                                </a>
                            </>
                        ) : (
                            ' · the top of the authority — nothing above it'
                        )}
                    </>
                }
                badges={
                    <>
                        <Badge tone={unit.isLeaf ? 'good' : 'neutral'}>
                            {unit.isLeaf ? 'Ground floor — dispatches work' : 'Oversees the layer below'}
                        </Badge>
                        {!unit.isActive && <Badge tone="warning">Inactive</Badge>}
                    </>
                }
                stats={[
                    { label: 'Open', value: stats.open },
                    {
                        label: 'Overdue',
                        value: stats.overdue,
                        tone: stats.overdue > 0 ? 'danger' : undefined,
                    },
                    { label: 'Awaiting inspection', value: stats.awaitingVerification },
                    { label: 'Resolved (30d)', value: stats.resolvedLast30d, tone: 'good' },
                    { label: 'Officers', value: stats.officers },
                    { label: 'Crew', value: stats.crew },
                ]}
                actions={
                    <div className="flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => setAdding((v) => !v)}
                            className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[color:var(--muted)]"
                        >
                            Add a unit inside
                        </button>
                        {parent && (
                            <button
                                type="button"
                                onClick={removeUnit}
                                disabled={busy || !removal.canRemove}
                                title={
                                    removal.canRemove
                                        ? `Remove ${unit.name}`
                                        : `Move these first: ${removal.blockers.join(', ')}`
                                }
                                className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-sm font-medium text-[color:var(--error)] disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[color:var(--error-bg)]"
                            >
                                Remove
                            </button>
                        )}
                    </div>
                }
            />

            {error && (
                <p className="mb-4 rounded-lg bg-[color:var(--error-bg)] px-3 py-2 text-sm text-[color:var(--error-fg)]">{error}</p>
            )}

            {!removal.canRemove && parent && (
                <p className="mb-4 text-xs text-[color:var(--muted-foreground)]">
                    This unit cannot be removed while it still holds {removal.blockers.join(', ')}.
                </p>
            )}

            {adding && (
                <form
                    action={addChild}
                    className="mb-5 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-4"
                >
                    <TableCaption
                        title={`Add a unit inside ${unit.name}`}
                        hint={`It will sit at depth ${unit.depth + 1}. Adding the first one turns ${unit.name} into an oversight layer.`}
                    />
                    <div className="grid gap-3 sm:grid-cols-3">
                        <Field name="name" label="Name" placeholder="Sector 63" required />
                        <Field name="code" label="Code" placeholder="SEC-63" required />
                        <Field
                            name="kindLabel"
                            label="Layer name"
                            placeholder={children[0]?.kindLabel ?? 'Sector'}
                        />
                    </div>
                    <div className="mt-3 flex gap-2">
                        <button
                            type="submit"
                            disabled={busy}
                            className="rounded-lg bg-[color:var(--primary)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                        >
                            {busy ? 'Adding…' : 'Add unit'}
                        </button>
                        <button
                            type="button"
                            onClick={() => setAdding(false)}
                            className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-sm"
                        >
                            Cancel
                        </button>
                    </div>
                </form>
            )}

            <section className="mb-8">
                <TableCaption
                    title={`Inside ${unit.name}`}
                    hint={
                        children.length > 0
                            ? 'Numbers include everything below each row. Open one to go deeper.'
                            : undefined
                    }
                    action={
                        children.length > 6 ? (
                            <Toolbar search={search} onSearch={setSearch} placeholder="Find a unit" />
                        ) : undefined
                    }
                />
                {children.length === 0 ? (
                    <NothingHere>
                        Nothing sits inside {unit.name} — it is the ground floor, so work is
                        dispatched from here rather than passed further down.
                    </NothingHere>
                ) : (
                    <DataTable
                        rows={children}
                        columns={columns}
                        getRowId={(r) => r.id}
                        search={search}
                        linkFor={(r) => `/admin/org/${r.id}`}
                        initialSort={{ key: 'overdue', direction: 'desc' }}
                        rowTone={(r) =>
                            r.stats.officers === 0 ? 'warning' : r.stats.overdue > 0 ? 'danger' : null
                        }
                        footnote="Rows with nobody posted are highlighted — complaints there fall through to this layer."
                    />
                )}
            </section>

            <section>
                <TableCaption
                    title={`Posted at ${unit.name}`}
                    hint="People posted to this unit itself, not to the units inside it."
                />
                {roster.length === 0 ? (
                    <NothingHere>
                        Nobody is posted here. Complaints that reach this unit will fall through to
                        the layer above.
                    </NothingHere>
                ) : (
                    <ul className="divide-y divide-[color:var(--border)] rounded-xl border border-[color:var(--border)] bg-[color:var(--card)]">
                        {roster.map((p) => (
                            <li
                                key={p.postingId}
                                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
                            >
                                <div className="min-w-0">
                                    <p className="text-sm font-medium">{p.fullName}</p>
                                    <p className="text-xs text-[color:var(--muted-foreground)]">
                                        {p.designationTitle ?? 'Officer'}
                                        {p.department ? ` · ${p.department.name}` : ''}
                                    </p>
                                </div>
                                {p.employeeCode && <Mono>{p.employeeCode}</Mono>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    )
}

function Badge({ children, tone }: { children: React.ReactNode; tone: 'good' | 'warning' | 'neutral' }) {
    const cls = {
        good: 'bg-[color:var(--success-bg)] text-[color:var(--success-fg)]',
        warning: 'bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]',
        neutral: 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]',
    }[tone]
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

function Field({
    name,
    label,
    placeholder,
    required,
}: {
    name: string
    label: string
    placeholder?: string
    required?: boolean
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">
                {label}
            </span>
            <input
                name={name}
                placeholder={placeholder}
                required={required}
                className="w-full rounded-lg border border-[color:var(--input)] bg-[color:var(--background)] px-3 py-1.5 text-sm"
            />
        </label>
    )
}
