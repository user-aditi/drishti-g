'use client'

import { useState } from 'react'
import type { FormEvent } from 'react'
import { Loader2 } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { ErrorBanner } from '@/components/shared/page-header'
import { Drawer, DrawerSection } from '@/components/console/drawer'
import { FormGrid, FullWidth, TextAreaField, TextField, ToggleField } from '@/components/console/form'
import { RANK_LABEL } from '@/lib/constants'
import type { Department, GeographyTree, StaffFile } from '@/types'
import { PostingFields, emptyPosting, postingPayload, type PostingForm } from './posting-fields'

/**
 * The three panels that change where somebody sits.
 *
 * Appointing, transferring and giving an additional charge ask the same
 * questions — which post, in which department, over which patch — so they share
 * one set of fields and differ only in what happens to the posting already
 * there.
 */

export function AppointDrawer({
    departments,
    geography,
    onClose,
    onSaved,
}: {
    departments: Department[]
    geography: GeographyTree[]
    onClose: () => void
    onSaved: () => void
}) {
    const [person, setPerson] = useState({ fullName: '', email: '', phone: '', password: '' })
    const [posting, setPosting] = useState<PostingForm>(emptyPosting())
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
            await apiClient.createStaff({
                fullName: person.fullName,
                email: person.email,
                phone: person.phone || undefined,
                password: person.password,
                ...postingPayload(posting),
            })
            onSaved()
        } catch (err) {
            setError(messageFrom(err, 'Could not create this posting.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Drawer
            open
            onClose={onClose}
            width="lg"
            title="Appoint someone to a post"
            subtitle="The account and the posting are created together — one without the other receives no work."
            footer={
                <>
                    <Button type="submit" form="appoint-form" disabled={saving}>
                        {saving && <Loader2 className="animate-spin" />}
                        Create posting
                    </Button>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                </>
            }
        >
            {error && <ErrorBanner message={error} />}

            <form id="appoint-form" onSubmit={submit}>
                <DrawerSection title="The person">
                    <FormGrid>
                        <TextField
                            id="fullName"
                            label="Full name"
                            required
                            minLength={2}
                            value={person.fullName}
                            onChange={(v) => setPerson((p) => ({ ...p, fullName: v }))}
                        />
                        <TextField
                            id="email"
                            label="Official email"
                            type="email"
                            required
                            placeholder="name@noidaauthority.in"
                            value={person.email}
                            onChange={(v) => setPerson((p) => ({ ...p, email: v }))}
                        />
                        <TextField
                            id="phone"
                            label="Phone"
                            maxLength={20}
                            value={person.phone}
                            onChange={(v) => setPerson((p) => ({ ...p, phone: v }))}
                        />
                        <TextField
                            id="password"
                            label="Temporary password"
                            type="text"
                            required
                            minLength={8}
                            hint="At least 8 characters. Give it to them directly."
                            value={person.password}
                            onChange={(v) => setPerson((p) => ({ ...p, password: v }))}
                        />
                    </FormGrid>
                </DrawerSection>

                <DrawerSection title="The post" description="What they answer for, and where.">
                    <FormGrid>
                        <PostingFields
                            form={posting}
                            onChange={setPosting}
                            departments={departments}
                            geography={geography}
                            idPrefix="ap-"
                        />
                        <TextField
                            id="ap-employeeCode"
                            label="Employee code"
                            maxLength={32}
                            hint="As printed on their ID card. Must be unique."
                            value={posting.employeeCode}
                            onChange={(v) => setPosting((p) => ({ ...p, employeeCode: v }))}
                        />
                    </FormGrid>
                </DrawerSection>
            </form>
        </Drawer>
    )
}

export function PostingActionDrawer({
    mode,
    person,
    departments,
    geography,
    onClose,
    onSaved,
}: {
    mode: 'transfer' | 'charge'
    person: StaffFile
    departments: Department[]
    geography: GeographyTree[]
    onClose: () => void
    onSaved: () => void
}) {
    const current = person.primaryPosting
    const [form, setForm] = useState<PostingForm>({
        ...emptyPosting(),
        rank: person.rank === 'CITIZEN' ? 'SECTION_OFFICER' : person.rank,
        departmentId: current?.department ? String(current.department.id) : '',
    })
    const [reason, setReason] = useState('')
    const [makePrimary, setMakePrimary] = useState(false)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
            if (mode === 'transfer') {
                await apiClient.transferStaff(person.id, { ...postingPayload(form), reason })
            } else {
                await apiClient.console.staff.addPosting(person.id, {
                    ...postingPayload(form),
                    isPrimary: makePrimary,
                })
            }
            onSaved()
        } catch (err) {
            setError(messageFrom(err, 'Could not save this posting.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Drawer
            open
            onClose={onClose}
            title={mode === 'transfer' ? `Transfer ${person.fullName}` : 'Additional charge'}
            subtitle={
                mode === 'transfer'
                    ? 'Their current posting ends and a new one begins. The old record survives.'
                    : `${person.fullName} keeps their existing post and covers this one as well.`
            }
            footer={
                <>
                    <Button type="submit" form="posting-form" disabled={saving}>
                        {saving && <Loader2 className="animate-spin" />}
                        {mode === 'transfer' ? 'Transfer' : 'Give charge'}
                    </Button>
                    <Button type="button" variant="outline" onClick={onClose}>
                        Cancel
                    </Button>
                </>
            }
        >
            {error && <ErrorBanner message={error} />}

            {current && (
                <p className="mb-5 rounded-lg bg-[color:var(--muted)] px-3 py-2.5 text-xs">
                    <span className="text-[color:var(--muted-foreground)]">Currently </span>
                    <strong>{current.designationTitle ?? RANK_LABEL[person.rank]}</strong>
                    <span className="text-[color:var(--muted-foreground)]">
                        {current.sector
                            ? ` · Sector ${current.sector.number}`
                            : current.circle
                              ? ` · ${current.circle.name}`
                              : current.zone
                                ? ` · ${current.zone.name}`
                                : ''}
                        {person.openCases > 0 &&
                            ` · carrying ${person.openCases} open ${person.openCases === 1 ? 'case' : 'cases'}`}
                    </span>
                </p>
            )}

            <form id="posting-form" onSubmit={submit}>
                <DrawerSection title="New post">
                    <FormGrid>
                        <PostingFields
                            form={form}
                            onChange={setForm}
                            departments={departments}
                            geography={geography}
                            idPrefix="np-"
                        />
                        <TextField
                            id="np-employeeCode"
                            label="Employee code"
                            maxLength={32}
                            value={form.employeeCode}
                            onChange={(v) => setForm((f) => ({ ...f, employeeCode: v }))}
                        />
                        {mode === 'transfer' ? (
                            <FullWidth>
                                <TextAreaField
                                    id="reason"
                                    label="Reason"
                                    rows={2}
                                    hint="Written into the audit trail alongside the transfer."
                                    value={reason}
                                    onChange={setReason}
                                />
                            </FullWidth>
                        ) : (
                            <FullWidth>
                                <ToggleField
                                    id="makePrimary"
                                    label="Make this their primary post"
                                    hint="The primary post is the one the app leads with, and the rank their account carries."
                                    checked={makePrimary}
                                    onChange={setMakePrimary}
                                />
                            </FullWidth>
                        )}
                    </FormGrid>
                </DrawerSection>
            </form>
        </Drawer>
    )
}

export function PasswordDrawer({
    person,
    onClose,
}: {
    person: StaffFile
    onClose: () => void
}) {
    const [password, setPassword] = useState('')
    const [saving, setSaving] = useState(false)
    const [done, setDone] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSaving(true)
        setError(null)
        try {
            await apiClient.console.staff.resetPassword(person.id, password)
            setDone(true)
        } catch (err) {
            setError(messageFrom(err, 'Could not reset the password.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <Drawer
            open
            onClose={onClose}
            title="Reset password"
            subtitle={person.email}
            footer={
                done ? (
                    <Button onClick={onClose}>Done</Button>
                ) : (
                    <>
                        <Button type="submit" form="password-form" disabled={saving}>
                            {saving && <Loader2 className="animate-spin" />}
                            Issue password
                        </Button>
                        <Button type="button" variant="outline" onClick={onClose}>
                            Cancel
                        </Button>
                    </>
                )
            }
        >
            {error && <ErrorBanner message={error} />}

            {done ? (
                <div className="rounded-lg border border-[color:var(--success-border)] bg-[color:var(--success-bg)] px-4 py-4">
                    <p className="text-sm font-semibold text-[color:var(--success-fg)]">Password issued</p>
                    <p className="mt-1 text-xs text-[color:var(--success-fg)]">
                        Read it to {person.fullName} directly. Only the hash is stored, so nobody —
                        including you — can recover it afterwards. They have been notified to change
                        it after signing in.
                    </p>
                    <p className="mt-3 rounded bg-white px-3 py-2 font-mono text-sm">{password}</p>
                </div>
            ) : (
                <form id="password-form" onSubmit={submit}>
                    <DrawerSection title="New password">
                        <TextField
                            id="password"
                            label="Password"
                            required
                            minLength={8}
                            type="text"
                            hint="At least 8 characters. You will see it once, on the next screen."
                            value={password}
                            onChange={setPassword}
                        />
                    </DrawerSection>
                </form>
            )}
        </Drawer>
    )
}
