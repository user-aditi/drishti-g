'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/shared/page-header'
import { Drawer, DrawerSection, FactList } from '@/components/console/drawer'
import {
    FormGrid,
    FullWidth,
    NumberField,
    SelectField,
    TextAreaField,
    TextField,
    ToggleField,
} from '@/components/console/form'
import { RANK_LABEL, TRADE_LABEL } from '@/lib/constants'
import type { CategoryRow, Department, Rank, Trade } from '@/types'

/**
 * Every editing form in the console, in one place.
 *
 * Reading a record happens on a page; *changing* one happens in a panel over
 * that page, so the reader never loses the context they were judging the change
 * from. Because the same record is reachable from several drill-downs — a
 * sector from the city list and from its circle — the forms live here rather
 * than inside any one page that happens to open them.
 */

/**
 * The ranks a person can actually hold a post at.
 *
 * Citizens hold none, and field workers no longer have accounts at all — street
 * labour reaches the system through a per-job code — so neither belongs in a
 * picker of posts.
 */
const POSTED_RANKS: Rank[] = [
    'SECTION_OFFICER',
    'CIRCLE_OFFICER',
    'ZONAL_OFFICER',
    'HOD',
    'CEO',
    'SUPER_ADMIN',
]

/**
 * The row of actions every editor drawer ends with.
 *
 * Shared so that Save sits in the same place on every form, and so a delete —
 * the one irreversible action here — always looks the same and is always the
 * furthest thing from the primary button.
 */
function EditorFooter({
    saving,
    deleting,
    onDelete,
    onClose,
    isNew,
    createLabel,
    deleteLabel = 'Delete',
}: {
    saving: boolean
    deleting?: boolean
    onDelete?: () => void
    onClose: () => void
    isNew: boolean
    createLabel: string
    deleteLabel?: string
}) {
    return (
        <div className="flex w-full items-center gap-2">
            {onDelete && (
                <Button
                    type="button"
                    variant="outline"
                    onClick={onDelete}
                    disabled={deleting || saving}
                    className="mr-auto text-[color:var(--error)] hover:bg-[color:var(--error-bg)]"
                >
                    {deleting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                        <Trash2 className="h-4 w-4" />
                    )}
                    {deleteLabel}
                </Button>
            )}
            <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={saving}
                className={onDelete ? '' : 'ml-auto'}
            >
                Cancel
            </Button>
            <Button type="submit" form="record-form" disabled={saving}>
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {isNew ? createLabel : 'Save changes'}
            </Button>
        </div>
    )
}

/*
 * The Zone, Circle and Sector editors used to live here.
 *
 * Geography is one recursive tree now: a unit is a unit at any depth, so three
 * near-identical forms became one, and it lives with the screen that draws the
 * tree rather than in a shared editor file. See app/admin/org/[unitId].
 */

export function DepartmentEditor({
    department,
    onClose,
    onSaved,
}: {
    department: Department | null
    onClose: () => void
    onSaved: () => void
}) {
    const [form, setForm] = useState({
        code: department?.code ?? '',
        name: department?.name ?? '',
        nameHi: department?.nameHi ?? '',
        icon: department?.icon ?? '🏛️',
        description: department?.description ?? '',
        roadmapNote: department?.roadmapNote ?? '',
        sortOrder: String(department?.sortOrder ?? 100),
        isLive: department?.status === 'ACTIVE',
    })
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSaving(true)
        setError(null)

        const status = form.isLive ? 'ACTIVE' : 'COMING_SOON'
        try {
            if (department) {
                await apiClient.updateDepartment(department.id, {
                    name: form.name,
                    icon: form.icon,
                    description: form.description || undefined,
                    roadmapNote: form.roadmapNote || null,
                    sortOrder: Number(form.sortOrder),
                    status,
                })
            } else {
                await apiClient.createDepartment({
                    code: form.code,
                    name: form.name,
                    nameHi: form.nameHi || undefined,
                    icon: form.icon,
                    description: form.description || undefined,
                    roadmapNote: form.roadmapNote || undefined,
                    sortOrder: Number(form.sortOrder),
                    status,
                })
            }
            onSaved()
        } catch (err) {
            setError(messageFrom(err, 'Could not save this department.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Drawer
            open
            onClose={onClose}
            title={department ? department.name : 'New department'}
            subtitle={department ? department.code : 'A new arm of the authority'}
            footer={
                <EditorFooter
                    saving={saving}
                    onClose={onClose}
                    isNew={!department}
                    createLabel="Create department"
                />
            }
        >
            {error && <ErrorBanner message={error} />}

            <form id="record-form" onSubmit={submit}>
                <DrawerSection title="Identity">
                    <FormGrid>
                        <TextField
                            id="code"
                            label="Code"
                            required
                            maxLength={16}
                            disabled={!!department}
                            hint={department ? 'Fixed once records reference it.' : undefined}
                            value={form.code}
                            onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))}
                        />
                        <TextField
                            id="icon"
                            label="Icon"
                            maxLength={4}
                            hint="One emoji. Used wherever this department appears."
                            value={form.icon}
                            onChange={(v) => setForm((f) => ({ ...f, icon: v }))}
                        />
                        <TextField
                            id="name"
                            label="Name"
                            required
                            minLength={2}
                            value={form.name}
                            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                        />
                        <TextField
                            id="nameHi"
                            label="Name in Hindi"
                            disabled={!!department}
                            value={form.nameHi}
                            onChange={(v) => setForm((f) => ({ ...f, nameHi: v }))}
                        />
                        <FullWidth>
                            <TextAreaField
                                id="description"
                                label="What it does"
                                rows={2}
                                hint="Shown to citizens choosing where to file."
                                value={form.description}
                                onChange={(v) => setForm((f) => ({ ...f, description: v }))}
                            />
                        </FullWidth>
                        <NumberField
                            id="sortOrder"
                            label="Display order"
                            hint="Lower numbers appear first."
                            value={form.sortOrder}
                            onChange={(v) => setForm((f) => ({ ...f, sortOrder: v }))}
                        />
                    </FormGrid>
                </DrawerSection>

                <DrawerSection title="Availability">
                    <div className="space-y-3">
                        <ToggleField
                            id="isLive"
                            label="Accepting complaints"
                            hint="A department must have at least one Section Officer posted before it can go live, or complaints will route to nobody."
                            checked={form.isLive}
                            onChange={(v) => setForm((f) => ({ ...f, isLive: v }))}
                        />
                        {!form.isLive && (
                            <TextAreaField
                                id="roadmapNote"
                                label="Roadmap note"
                                rows={2}
                                hint="Shown on the department card while it is not yet live."
                                value={form.roadmapNote}
                                onChange={(v) => setForm((f) => ({ ...f, roadmapNote: v }))}
                            />
                        )}
                    </div>
                </DrawerSection>
            </form>
        </Drawer>
    )
}

export interface DesignationShape {
    id: number
    rank: Rank
    rankLabel: string
    title: string
    titleHi: string | null
    shortTitle: string | null
    holders: number
}

export function DesignationEditor({
    designation,
    departmentId,
    departmentName,
    onClose,
    onSaved,
}: {
    designation: DesignationShape | null
    departmentId: number
    departmentName: string
    onClose: () => void
    onSaved: () => void
}) {
    const [form, setForm] = useState({
        rank: designation?.rank ?? ('SECTION_OFFICER' as Rank),
        title: designation?.title ?? '',
        titleHi: designation?.titleHi ?? '',
        shortTitle: designation?.shortTitle ?? '',
    })
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
            await apiClient.console.designations.set({
                departmentId,
                rank: form.rank,
                title: form.title,
                titleHi: form.titleHi || null,
                shortTitle: form.shortTitle || null,
            })
            onSaved()
        } catch (err) {
            setError(messageFrom(err, 'Could not save this title.'))
        } finally {
            setSaving(false)
        }
    }

    async function remove() {
        if (!designation) return
        setDeleting(true)
        try {
            await apiClient.console.designations.remove(designation.id)
            onSaved()
        } catch (err) {
            setError(messageFrom(err, 'Could not remove this title.'))
        } finally {
            setDeleting(false)
        }
    }

    return (
        <Drawer
            open
            onClose={onClose}
            title={designation ? designation.title : 'Name a post'}
            subtitle={`${departmentName}${designation ? ` · ${designation.rankLabel}` : ''}`}
            badge={
                designation && designation.holders > 0 ? (
                    <Badge variant="info">{designation.holders} holding it</Badge>
                ) : undefined
            }
            footer={
                <EditorFooter
                    saving={saving}
                    deleting={deleting}
                    onDelete={designation ? remove : undefined}
                    onClose={onClose}
                    isNew={!designation}
                    createLabel="Save title"
                    deleteLabel="Remove"
                />
            }
        >
            {error && <ErrorBanner message={error} />}

            <p className="mb-5 rounded-lg bg-[color:var(--accent)] px-3 py-2.5 text-xs text-[color:var(--accent-foreground)]">
                The rank decides routing and escalation. The title is what the person is actually
                called — a Junior Engineer in Civil is a Sanitary Inspector in Public Health.
                Renaming an occupied post updates everyone currently holding it.
            </p>

            <form id="record-form" onSubmit={submit}>
                <DrawerSection title="The post">
                    <FormGrid>
                        <SelectField
                            id="rank"
                            label="Rank"
                            required
                            disabled={!!designation}
                            hint="Where the post sits on the escalation ladder."
                            value={form.rank}
                            onChange={(v) => setForm((f) => ({ ...f, rank: v as Rank }))}
                        >
                            {POSTED_RANKS.map((r) => (
                                <option key={r} value={r}>
                                    {RANK_LABEL[r]}
                                </option>
                            ))}
                        </SelectField>
                        <TextField
                            id="shortTitle"
                            label="Short form"
                            maxLength={16}
                            placeholder="e.g. SI"
                            value={form.shortTitle}
                            onChange={(v) => setForm((f) => ({ ...f, shortTitle: v }))}
                        />
                        <TextField
                            id="title"
                            label="Called"
                            required
                            minLength={2}
                            placeholder="e.g. Sanitary Inspector"
                            value={form.title}
                            onChange={(v) => setForm((f) => ({ ...f, title: v }))}
                        />
                        <TextField
                            id="titleHi"
                            label="Title in Hindi"
                            value={form.titleHi}
                            onChange={(v) => setForm((f) => ({ ...f, titleHi: v }))}
                        />
                    </FormGrid>
                </DrawerSection>
            </form>
        </Drawer>
    )
}

export function CategoryEditor({
    category,
    departmentId,
    departmentName,
    onClose,
    onSaved,
}: {
    category: CategoryRow | DepartmentCategory | null
    departmentId: number
    departmentName: string
    onClose: () => void
    onSaved: () => void
}) {
    const [form, setForm] = useState({
        code: category?.code ?? '',
        name: category?.name ?? '',
        nameHi: category?.nameHi ?? '',
        icon: category?.icon ?? '📋',
        defaultSlaHours: String(category?.defaultSlaHours ?? 72),
        keywords: category?.keywords ?? '',
        trade: (category?.trade ?? '') as Trade | '',
        isActive: category?.isActive ?? true,
        sortOrder: String(category?.sortOrder ?? 100),
    })
    const [saving, setSaving] = useState(false)
    const [deleting, setDeleting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSaving(true)
        setError(null)

        const payload = {
            code: form.code,
            name: form.name,
            nameHi: form.nameHi || null,
            icon: form.icon,
            departmentId,
            defaultSlaHours: Number(form.defaultSlaHours),
            keywords: form.keywords,
            trade: form.trade || null,
            isActive: form.isActive,
            sortOrder: Number(form.sortOrder),
        }

        try {
            if (category) await apiClient.console.categories.update(category.id, payload)
            else await apiClient.console.categories.create(payload)
            onSaved()
        } catch (err) {
            setError(messageFrom(err, 'Could not save this category.'))
        } finally {
            setSaving(false)
        }
    }

    async function remove() {
        if (!category) return
        setDeleting(true)
        try {
            await apiClient.console.categories.remove(category.id)
            onSaved()
        } catch (err) {
            setError(messageFrom(err, 'Could not delete this category.'))
        } finally {
            setDeleting(false)
        }
    }

    return (
        <Drawer
            open
            onClose={onClose}
            width="lg"
            title={category ? category.name : 'New complaint category'}
            subtitle={`Routes to ${departmentName}`}
            badge={category && !category.isActive ? <Badge variant="neutral">Closed</Badge> : undefined}
            footer={
                <EditorFooter
                    saving={saving}
                    deleting={deleting}
                    onDelete={category ? remove : undefined}
                    onClose={onClose}
                    isNew={!category}
                    createLabel="Create category"
                />
            }
        >
            {error && <ErrorBanner message={error} />}

            <form id="record-form" onSubmit={submit}>
                <DrawerSection title="Identity">
                    <FormGrid>
                        <TextField
                            id="code"
                            label="Code"
                            required
                            maxLength={32}
                            disabled={!!category}
                            value={form.code}
                            onChange={(v) => setForm((f) => ({ ...f, code: v.toUpperCase() }))}
                        />
                        <TextField
                            id="icon"
                            label="Icon"
                            maxLength={4}
                            value={form.icon}
                            onChange={(v) => setForm((f) => ({ ...f, icon: v }))}
                        />
                        <TextField
                            id="name"
                            label="Name"
                            required
                            minLength={2}
                            value={form.name}
                            onChange={(v) => setForm((f) => ({ ...f, name: v }))}
                        />
                        <TextField
                            id="nameHi"
                            label="Name in Hindi"
                            hint="Shown to citizens filing in Hindi."
                            value={form.nameHi}
                            onChange={(v) => setForm((f) => ({ ...f, nameHi: v }))}
                        />
                    </FormGrid>
                </DrawerSection>

                <DrawerSection
                    title="Routing"
                    description="What GCCE does with a complaint that lands in this category."
                >
                    <FormGrid>
                        <SelectField
                            id="trade"
                            label="Usual trade"
                            hint="Narrows the crew list when an officer allots the work."
                            value={form.trade}
                            onChange={(v) => setForm((f) => ({ ...f, trade: v as Trade | '' }))}
                        >
                            <option value="">Any trade</option>
                            {Object.entries(TRADE_LABEL).map(([value, label]) => (
                                <option key={value} value={value}>
                                    {label}
                                </option>
                            ))}
                        </SelectField>
                        <NumberField
                            id="defaultSlaHours"
                            label="Deadline (hours)"
                            required
                            min={1}
                            max={8760}
                            hint="Escalation fires once this passes. Applies to complaints filed from now on."
                            value={form.defaultSlaHours}
                            onChange={(v) => setForm((f) => ({ ...f, defaultSlaHours: v }))}
                        />
                        <FullWidth>
                            <TextAreaField
                                id="keywords"
                                label="Keywords"
                                rows={3}
                                hint="Comma separated. GCCE matches a citizen's words against these — include the Hinglish they will actually type, e.g. gaddha, kachra, streetlight."
                                value={form.keywords}
                                onChange={(v) => setForm((f) => ({ ...f, keywords: v }))}
                            />
                        </FullWidth>
                        <NumberField
                            id="sortOrder"
                            label="Display order"
                            value={form.sortOrder}
                            onChange={(v) => setForm((f) => ({ ...f, sortOrder: v }))}
                        />
                        <FullWidth>
                            <ToggleField
                                id="isActive"
                                label="Open for filing"
                                hint="Switching this off hides the category from citizens without touching the complaints already filed under it."
                                checked={form.isActive}
                                onChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
                            />
                        </FullWidth>
                    </FormGrid>
                </DrawerSection>
            </form>

            {category && category.complaintCount > 0 && (
                <DrawerSection title="Use">
                    <FactList
                        items={[
                            { label: 'Complaints filed', value: category.complaintCount },
                            {
                                label: 'Deletion',
                                value: 'Blocked while complaints reference it — close it instead.',
                            },
                        ]}
                    />
                </DrawerSection>
            )}
        </Drawer>
    )
}

/** The category shape a department page carries, which omits the joined department. */
export interface DepartmentCategory {
    id: number
    code: string
    name: string
    nameHi: string | null
    icon: string
    defaultSlaHours: number
    keywords: string
    trade: Trade | null
    isActive: boolean
    sortOrder: number
    complaintCount: number
}
