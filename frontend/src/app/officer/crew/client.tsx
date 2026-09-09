'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Phone, UserPlus } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/shared/page-header'
import { Count, DataTable, RowTitle, type Column } from '@/components/shared/data-table'
import { Drawer, DrawerSection } from '@/components/console/drawer'
import { FormGrid, FullWidth, SelectField, TextField, ToggleField } from '@/components/console/form'
import { Toolbar } from '@/components/console/toolbar'
import { TRADE_LABEL } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { CrewRow, Trade } from '@/types'

export function CrewClient({
    crew,
    canManage,
    defaultSectorId,
    defaultDepartmentId,
}: {
    crew: CrewRow[]
    canManage: boolean
    defaultSectorId: number | null
    defaultDepartmentId: number | null
}) {
    const router = useRouter()
    const [search, setSearch] = useState('')
    const [editing, setEditing] = useState<CrewRow | null>(null)
    const [adding, setAdding] = useState(false)

    const columns: Column<CrewRow>[] = [
        {
            key: 'name',
            header: 'Name',
            value: (c) => `${c.fullName} ${c.phone ?? ''}`,
            cell: (c) => (
                <RowTitle hint="On the authority rolls">
                    <span className={cn(!c.isActive && 'line-through opacity-60')}>{c.fullName}</span>
                </RowTitle>
            ),
        },
        {
            key: 'trade',
            header: 'Trade',
            value: (c) => TRADE_LABEL[c.trade],
            cell: (c) => <Badge variant="neutral">{TRADE_LABEL[c.trade]}</Badge>,
        },
        {
            key: 'phone',
            header: 'Phone',
            value: (c) => c.phone,
            cell: (c) =>
                c.phone ? (
                    <a
                        href={`tel:${c.phone}`}
                        className="tnum inline-flex items-center gap-1.5 text-xs text-[color:var(--primary)] hover:underline"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <Phone className="h-3 w-3" aria-hidden />
                        {c.phone}
                    </a>
                ) : (
                    <span className="opacity-40">—</span>
                ),
        },
        {
            key: 'sector',
            header: 'Sector',
            secondary: true,
            value: (c) => c.sector?.number ?? null,
            cell: (c) => (
                <span className="text-xs">{c.sector ? `Sector ${c.sector.number}` : '—'}</span>
            ),
        },
        {
            key: 'open',
            header: 'Jobs out now',
            align: 'right',
            value: (c) => c.openJobs,
            cell: (c) => <Count value={c.openJobs} />,
        },
        {
            key: 'status',
            header: 'On the roll',
            value: (c) => (c.isActive ? 'Yes' : 'No'),
            cell: (c) =>
                c.isActive ? (
                    <Badge variant="success">Working</Badge>
                ) : (
                    <Badge variant="neutral">Off the roll</Badge>
                ),
        },
    ]

    return (
        <div>
            <Toolbar
                search={search}
                onSearch={setSearch}
                placeholder="Search your crew by name, phone or trade"
                actions={
                    canManage ? (
                        <Button size="sm" onClick={() => setAdding(true)}>
                            <UserPlus />
                            Add someone
                        </Button>
                    ) : undefined
                }
            />

            <DataTable
                rows={crew}
                columns={columns}
                getRowId={(c) => c.id}
                search={search}
                activeId={editing?.id ?? null}
                onRowClick={canManage ? setEditing : undefined}
                rowTone={(c) => (c.isActive ? null : 'muted')}
                empty={
                    canManage
                        ? 'Nobody on your roll yet. Add the people who actually work your sector.'
                        : 'No crew recorded in your jurisdiction yet.'
                }
                footnote="Crew have no login. A job reaches them as a code you hand over."
            />

            {(adding || editing) && canManage && (
                <CrewEditor
                    member={editing}
                    defaultSectorId={defaultSectorId}
                    defaultDepartmentId={defaultDepartmentId}
                    onClose={() => {
                        setAdding(false)
                        setEditing(null)
                    }}
                    onSaved={() => {
                        setAdding(false)
                        setEditing(null)
                        router.refresh()
                    }}
                />
            )}
        </div>
    )
}

function CrewEditor({
    member,
    defaultSectorId,
    defaultDepartmentId,
    onClose,
    onSaved,
}: {
    member: CrewRow | null
    defaultSectorId: number | null
    defaultDepartmentId: number | null
    onClose: () => void
    onSaved: () => void
}) {
    const [form, setForm] = useState({
        fullName: member?.fullName ?? '',
        phone: member?.phone ?? '',
        trade: (member?.trade ?? 'SAFAI_KARAMCHARI') as Trade,
        isActive: member?.isActive ?? true,
    })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSaving(true)
        setError(null)

        const payload = {
            fullName: form.fullName,
            phone: form.phone || null,
            trade: form.trade,
        }

        try {
            if (member) {
                await apiClient.crew.update(member.id, { ...payload, isActive: form.isActive })
            } else {
                await apiClient.crew.add({
                    ...payload,
                    sectorId: defaultSectorId,
                    departmentId: defaultDepartmentId,
                })
            }
            onSaved()
        } catch (err) {
            setError(messageFrom(err, 'Could not save this crew member.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Drawer
            open
            onClose={onClose}
            title={member ? member.fullName : 'Add someone to your crew'}
            subtitle={
                member
                    ? `${TRADE_LABEL[member.trade]}${member.sector ? ` · Sector ${member.sector.number}` : ''}`
                    : 'A name, a phone and a trade. No account, no password.'
            }
            footer={
                <>
                    <Button type="submit" form="crew-form" disabled={saving}>
                        {saving && <Loader2 className="animate-spin" />}
                        {member ? 'Save changes' : 'Add to roll'}
                    </Button>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                </>
            }
        >
            {error && <ErrorBanner message={error} />}

            <form id="crew-form" onSubmit={submit}>
                <DrawerSection title="Who they are">
                    <FormGrid>
                        <TextField
                            id="fullName"
                            label="Name"
                            required
                            minLength={2}
                            value={form.fullName}
                            onChange={(v) => setForm((f) => ({ ...f, fullName: v }))}
                        />
                        <TextField
                            id="phone"
                            label="Phone"
                            type="tel"
                            maxLength={20}
                            hint="How you reach them, and how they reach you."
                            value={form.phone}
                            onChange={(v) => setForm((f) => ({ ...f, phone: v }))}
                        />
                        <SelectField
                            id="trade"
                            label="Trade"
                            required
                            hint="Decides which jobs you can hand them."
                            value={form.trade}
                            onChange={(v) => setForm((f) => ({ ...f, trade: v as Trade }))}
                        >
                            {Object.entries(TRADE_LABEL).map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </SelectField>

                        {member && (
                            <FullWidth>
                                <ToggleField
                                    id="isActive"
                                    label="Still working this sector"
                                    hint="Switch off when they move on. Their past jobs keep their record."
                                    checked={form.isActive}
                                    onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                                />
                            </FullWidth>
                        )}
                    </FormGrid>
                </DrawerSection>
            </form>
        </Drawer>
    )
}
