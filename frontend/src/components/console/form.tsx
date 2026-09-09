'use client'

import type { ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * Form fields for the control room.
 *
 * Thin wrappers over the shared inputs, existing only so that every register's
 * editor is laid out identically — label, control, then the one sentence that
 * says what the field will actually do. A Super Admin editing an SLA should not
 * have to guess whether it applies to new complaints or existing ones.
 */

export function FormGrid({ children, columns = 2 }: { children: ReactNode; columns?: 1 | 2 }) {
    return (
        <div className={cn('grid gap-4', columns === 2 && 'sm:grid-cols-2')}>{children}</div>
    )
}

/** Spans both columns of a FormGrid — for descriptions and reasons. */
export function FullWidth({ children }: { children: ReactNode }) {
    return <div className="sm:col-span-2">{children}</div>
}

function FieldShell({
    id,
    label,
    hint,
    required,
    children,
}: {
    id: string
    label: string
    hint?: string
    required?: boolean
    children: ReactNode
}) {
    return (
        <div>
            <Label htmlFor={id}>
                {label}
                {required && (
                    <span className="ml-1 text-[color:var(--error)]" aria-hidden>
                        *
                    </span>
                )}
            </Label>
            {children}
            {hint && (
                <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">{hint}</p>
            )}
        </div>
    )
}

export function TextField({
    id,
    label,
    hint,
    value,
    onChange,
    ...rest
}: {
    id: string
    label: string
    hint?: string
    value: string
    onChange: (v: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange'>) {
    return (
        <FieldShell id={id} label={label} hint={hint} required={rest.required}>
            <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
        </FieldShell>
    )
}

export function NumberField({
    id,
    label,
    hint,
    value,
    onChange,
    ...rest
}: {
    id: string
    label: string
    hint?: string
    value: string
    onChange: (v: string) => void
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'id' | 'value' | 'onChange' | 'type'>) {
    return (
        <FieldShell id={id} label={label} hint={hint} required={rest.required}>
            <Input
                id={id}
                type="number"
                inputMode="decimal"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                {...rest}
            />
        </FieldShell>
    )
}

export function SelectField({
    id,
    label,
    hint,
    value,
    onChange,
    children,
    ...rest
}: {
    id: string
    label: string
    hint?: string
    value: string
    onChange: (v: string) => void
    children: ReactNode
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'id' | 'value' | 'onChange'>) {
    return (
        <FieldShell id={id} label={label} hint={hint} required={rest.required}>
            <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest}>
                {children}
            </Select>
        </FieldShell>
    )
}

export function TextAreaField({
    id,
    label,
    hint,
    value,
    onChange,
    ...rest
}: {
    id: string
    label: string
    hint?: string
    value: string
    onChange: (v: string) => void
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'id' | 'value' | 'onChange'>) {
    return (
        <FieldShell id={id} label={label} hint={hint} required={rest.required}>
            <Textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />
        </FieldShell>
    )
}

/** A switch rendered as a labelled row, so the state reads as a sentence. */
export function ToggleField({
    id,
    label,
    hint,
    checked,
    onChange,
    disabled,
}: {
    id: string
    label: string
    hint?: string
    checked: boolean
    onChange: (v: boolean) => void
    disabled?: boolean
}) {
    return (
        <label
            htmlFor={id}
            className={cn(
                'flex cursor-pointer items-start gap-3 rounded-lg border border-[color:var(--border)] px-3 py-2.5',
                disabled && 'cursor-not-allowed opacity-60',
            )}
        >
            <input
                id={id}
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(e) => onChange(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
            />
            <span className="min-w-0">
                <span className="block text-sm font-medium">{label}</span>
                {hint && (
                    <span className="mt-0.5 block text-xs text-[color:var(--muted-foreground)]">
                        {hint}
                    </span>
                )}
            </span>
        </label>
    )
}

/** Zones → circles → sectors, grouped so a picker shows the chain of command. */
export function SectorOptions({
    geography,
}: {
    geography: { id: number; name: string; circles: { id: number; name: string; sectors: { id: number; number: number; name: string }[] }[] }[]
}) {
    return (
        <>
            {geography.map((zone) =>
                zone.circles.map((circle) => (
                    <optgroup key={circle.id} label={`${zone.name} · ${circle.name}`}>
                        {circle.sectors.map((s) => (
                            <option key={s.id} value={s.id}>
                                Sector {s.number} — {s.name}
                            </option>
                        ))}
                    </optgroup>
                )),
            )}
        </>
    )
}
