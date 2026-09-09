'use client'

import { SelectField } from '@/components/console/form'
import { RANK_LABEL, TRADE_LABEL } from '@/lib/constants'
import type { Department, GeographyTree, Rank, Trade } from '@/types'

/**
 * The jurisdiction a posting must carry, mirroring RANK_JURISDICTION on the
 * server. Getting this wrong puts someone on the org chart who routing cannot
 * see, so the form asks for exactly what the rank requires and nothing else.
 */
export const NEEDS: Record<string, 'zone' | 'circle' | 'sector' | 'none'> = {
    HOD: 'none',
    ZONAL_OFFICER: 'zone',
    CIRCLE_OFFICER: 'circle',
    SECTION_OFFICER: 'sector',
    FIELD_WORKER: 'sector',
}

/** Ranks the Super Admin can appoint, from the top down. */
export const APPOINTABLE: Rank[] = [
    'HOD',
    'ZONAL_OFFICER',
    'CIRCLE_OFFICER',
    'SECTION_OFFICER',
    'FIELD_WORKER',
]

export interface PostingForm {
    rank: Rank
    departmentId: string
    zoneId: string
    circleId: string
    sectorId: string
    trade: Trade | ''
    employeeCode: string
}

export const emptyPosting = (): PostingForm => ({
    rank: 'SECTION_OFFICER',
    departmentId: '',
    zoneId: '',
    circleId: '',
    sectorId: '',
    trade: '',
    employeeCode: '',
})

/** Turn the form into the payload both `/staff` and the console expect. */
export function postingPayload(form: PostingForm): Record<string, unknown> {
    const needs = NEEDS[form.rank] ?? 'none'
    return {
        rank: form.rank,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        zoneId: needs === 'zone' && form.zoneId ? Number(form.zoneId) : null,
        circleId: needs === 'circle' && form.circleId ? Number(form.circleId) : null,
        sectorId: needs === 'sector' && form.sectorId ? Number(form.sectorId) : null,
        trade: form.rank === 'FIELD_WORKER' && form.trade ? form.trade : null,
        employeeCode: form.employeeCode || null,
    }
}

/**
 * The rank / department / jurisdiction block, shared by appointing, transferring
 * and adding a second charge — three flows that ask exactly the same questions.
 */
export function PostingFields({
    form,
    onChange,
    departments,
    geography,
    idPrefix = '',
}: {
    form: PostingForm
    onChange: (next: PostingForm) => void
    departments: Department[]
    geography: GeographyTree[]
    idPrefix?: string
}) {
    const needs = NEEDS[form.rank] ?? 'none'
    const set = <K extends keyof PostingForm>(key: K, value: PostingForm[K]) =>
        onChange({ ...form, [key]: value })
    const id = (name: string) => `${idPrefix}${name}`

    return (
        <>
            <SelectField
                id={id('rank')}
                label="Post"
                required
                hint="Decides both where they sit on the escalation ladder and what they can do."
                value={form.rank}
                onChange={(v) => set('rank', v as Rank)}
            >
                {APPOINTABLE.map((r) => (
                    <option key={r} value={r}>
                        {RANK_LABEL[r]}
                    </option>
                ))}
            </SelectField>

            <SelectField
                id={id('departmentId')}
                label="Department"
                required
                hint="Their designation comes from this department's naming."
                value={form.departmentId}
                onChange={(v) => set('departmentId', v)}
            >
                <option value="">Select a department</option>
                {departments.map((d) => (
                    <option key={d.id} value={d.id}>
                        {d.icon} {d.name}
                        {d.status === 'COMING_SOON' ? ' (not live yet)' : ''}
                    </option>
                ))}
            </SelectField>

            {needs === 'zone' && (
                <SelectField
                    id={id('zoneId')}
                    label="Zone"
                    required
                    value={form.zoneId}
                    onChange={(v) => set('zoneId', v)}
                >
                    <option value="">Select a zone</option>
                    {geography.map((z) => (
                        <option key={z.id} value={z.id}>
                            {z.name}
                        </option>
                    ))}
                </SelectField>
            )}

            {needs === 'circle' && (
                <SelectField
                    id={id('circleId')}
                    label="Work circle"
                    required
                    hint="Escalations from this circle's sectors will land on them."
                    value={form.circleId}
                    onChange={(v) => set('circleId', v)}
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
                </SelectField>
            )}

            {needs === 'sector' && (
                <SelectField
                    id={id('sectorId')}
                    label="Sector"
                    required
                    hint="Complaints filed here will route to them."
                    value={form.sectorId}
                    onChange={(v) => set('sectorId', v)}
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
                </SelectField>
            )}

            {form.rank === 'FIELD_WORKER' && (
                <SelectField
                    id={id('trade')}
                    label="Trade"
                    required
                    hint="Determines which jobs their officer can allot to them."
                    value={form.trade}
                    onChange={(v) => set('trade', v as Trade | '')}
                >
                    <option value="">Select a trade</option>
                    {Object.entries(TRADE_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                            {label}
                        </option>
                    ))}
                </SelectField>
            )}
        </>
    )
}
