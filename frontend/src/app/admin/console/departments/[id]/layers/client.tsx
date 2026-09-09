'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { TableCaption } from '@/components/console/detail'
import { apiClient } from '@/lib/api-client'
import type { DepartmentLayerRow, DepartmentLayersResponse } from '@/types'

interface Draft {
    depth: number
    name: string
    namePlural: string
    canDispatch: boolean
    slaHours: number
    minPostings: number
    /** Present only for layers that already exist — used to warn before removal. */
    existing?: DepartmentLayerRow
}

const toDraft = (l: DepartmentLayerRow): Draft => ({
    depth: l.depth,
    name: l.name,
    namePlural: l.namePlural,
    canDispatch: l.canDispatch,
    slaHours: l.slaHours,
    minPostings: l.minPostings,
    existing: l,
})

/**
 * The layer editor.
 *
 * Edited as a whole rather than row by row, because the layers only mean
 * anything as a set: they must run contiguously from the city downward, and
 * exactly the deepest one dispatches work. Both rules are enforced here for
 * immediate feedback and again on the server, which is the one that counts.
 */
export function LayersClient({ data }: { data: DepartmentLayersResponse }) {
    const router = useRouter()
    const [drafts, setDrafts] = useState<Draft[]>(data.layers.map(toDraft))
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)

    const update = (index: number, patch: Partial<Draft>) => {
        setSaved(false)
        setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
    }

    const addLayer = () => {
        setSaved(false)
        setDrafts((prev) => [
            // The new layer becomes the deepest, so dispatch moves down to it.
            ...prev.map((d) => ({ ...d, canDispatch: false })),
            {
                depth: prev.length,
                name: '',
                namePlural: '',
                canDispatch: true,
                slaHours: 24,
                minPostings: 1,
            },
        ])
    }

    const removeDeepest = () => {
        setSaved(false)
        setDrafts((prev) => {
            const next = prev.slice(0, -1)
            if (next.length === 0) return prev
            return next.map((d, i) => ({ ...d, canDispatch: i === next.length - 1 }))
        })
    }

    const deepest = drafts[drafts.length - 1]
    const incomplete = drafts.some((d) => !d.name.trim() || !d.namePlural.trim())

    async function save() {
        setBusy(true)
        setError(null)
        try {
            await apiClient.org.saveLayers(
                data.department.id,
                drafts.map((d, i) => ({
                    depth: i,
                    name: d.name.trim(),
                    namePlural: d.namePlural.trim(),
                    canDispatch: i === drafts.length - 1,
                    slaHours: d.slaHours,
                    minPostings: d.minPostings,
                })),
            )
            setSaved(true)
            router.refresh()
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save these layers')
        } finally {
            setBusy(false)
        }
    }

    return (
        <div>
            <TableCaption
                title="Layers, top to bottom"
                hint="The first row is the whole city. The last is the floor nearest the citizen — the only one that hands work to a crew."
            />

            <ol className="space-y-3">
                {drafts.map((draft, index) => {
                    const isDeepest = index === drafts.length - 1
                    return (
                        <li
                            key={index}
                            className="rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-4"
                        >
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                                <span className="rounded-full bg-[color:var(--muted)] px-2 py-0.5 text-[11px] font-medium text-[color:var(--muted-foreground)]">
                                    Depth {index}
                                </span>
                                {index === 0 && <Tag tone="neutral">The whole city</Tag>}
                                {isDeepest && <Tag tone="good">Dispatches work to crew</Tag>}
                                {!isDeepest && index > 0 && <Tag tone="neutral">Receives escalations</Tag>}
                                {draft.existing && (
                                    <span className="ml-auto text-xs text-[color:var(--muted-foreground)]">
                                        {draft.existing.unitCount} unit
                                        {draft.existing.unitCount === 1 ? '' : 's'} ·{' '}
                                        {draft.existing.vacantUnitCount > 0 ? (
                                            <span className="font-medium text-[color:var(--warning-fg)]">
                                                {draft.existing.vacantUnitCount} with nobody posted
                                            </span>
                                        ) : (
                                            'all staffed'
                                        )}
                                    </span>
                                )}
                            </div>

                            <div className="grid gap-3 sm:grid-cols-4">
                                <Field
                                    label="Called"
                                    value={draft.name}
                                    onChange={(v) => update(index, { name: v })}
                                    placeholder={index === 0 ? 'City' : isDeepest ? 'Sector' : 'Zone'}
                                />
                                <Field
                                    label="Plural"
                                    value={draft.namePlural}
                                    onChange={(v) => update(index, { namePlural: v })}
                                    placeholder={index === 0 ? 'City' : isDeepest ? 'Sectors' : 'Zones'}
                                />
                                <NumberField
                                    label="Hours before it climbs"
                                    value={draft.slaHours}
                                    min={1}
                                    max={8760}
                                    onChange={(v) => update(index, { slaHours: v })}
                                />
                                <NumberField
                                    label="Min. officers per unit"
                                    value={draft.minPostings}
                                    min={0}
                                    max={100}
                                    onChange={(v) => update(index, { minPostings: v })}
                                />
                            </div>
                        </li>
                    )
                })}
            </ol>

            <div className="mt-4 flex flex-wrap items-center gap-2">
                <button
                    type="button"
                    onClick={addLayer}
                    className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-sm font-medium hover:bg-[color:var(--muted)]"
                >
                    Add a layer below
                </button>
                <button
                    type="button"
                    onClick={removeDeepest}
                    disabled={drafts.length <= 1}
                    className="rounded-lg border border-[color:var(--border)] px-3 py-1.5 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-40 hover:bg-[color:var(--muted)]"
                >
                    Remove the deepest layer
                </button>
                <button
                    type="button"
                    onClick={save}
                    disabled={busy || incomplete}
                    className="ml-auto rounded-lg bg-[color:var(--primary)] px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                    {busy ? 'Saving…' : 'Save layers'}
                </button>
            </div>

            {incomplete && (
                <p className="mt-2 text-xs text-[color:var(--warning-fg)]">
                    Every layer needs a name before this can be saved.
                </p>
            )}
            {error && (
                <p className="mt-3 rounded-lg bg-[color:var(--error-bg)] px-3 py-2 text-sm text-[color:var(--error-fg)]">{error}</p>
            )}
            {saved && !error && (
                <p className="mt-3 rounded-lg bg-[color:var(--success-bg)] px-3 py-2 text-sm text-[color:var(--success-fg)]">
                    Saved. {data.department.name} now works through {drafts.length} layer
                    {drafts.length === 1 ? '' : 's'}, dispatching from {deepest?.name || 'the deepest'}.
                </p>
            )}

            <p className="mt-6 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                Removing a layer is refused while complaints are still open at it — move or resolve
                them first. Departments share one map of the city, so shortening this department
                does not change anyone else&rsquo;s.
            </p>
        </div>
    )
}

function Tag({ children, tone }: { children: React.ReactNode; tone: 'good' | 'neutral' }) {
    const cls =
        tone === 'good'
            ? 'bg-[color:var(--success-bg)] text-[color:var(--success-fg)]'
            : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]'
    return <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${cls}`}>{children}</span>
}

function Field({
    label,
    value,
    onChange,
    placeholder,
}: {
    label: string
    value: string
    onChange: (v: string) => void
    placeholder?: string
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">
                {label}
            </span>
            <input
                value={value}
                placeholder={placeholder}
                onChange={(e) => onChange(e.target.value)}
                className="w-full rounded-lg border border-[color:var(--input)] bg-[color:var(--background)] px-3 py-1.5 text-sm"
            />
        </label>
    )
}

function NumberField({
    label,
    value,
    onChange,
    min,
    max,
}: {
    label: string
    value: number
    onChange: (v: number) => void
    min: number
    max: number
}) {
    return (
        <label className="block">
            <span className="mb-1 block text-xs font-medium text-[color:var(--muted-foreground)]">
                {label}
            </span>
            <input
                type="number"
                value={value}
                min={min}
                max={max}
                onChange={(e) => onChange(Number(e.target.value))}
                className="w-full rounded-lg border border-[color:var(--input)] bg-[color:var(--background)] px-3 py-1.5 text-sm"
            />
        </label>
    )
}
