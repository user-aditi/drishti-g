'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorNotice, InfoNotice } from '@/components/shared/notices'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import type { Area, User } from '@/types'

export function ProfileForm({ user, areas, showHomeBoard }: { user: User; areas: Area[]; showHomeBoard: boolean }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [name, setName] = useState(user.name)
    const [phone, setPhone] = useState(user.phone ?? '')
    const [orgUnitId, setOrgUnitId] = useState<number | ''>(user.orgUnit?.id ?? '')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [saved, setSaved] = useState(false)

    async function submit(event: React.FormEvent) {
        event.preventDefault()
        setBusy(true)
        setError(null)
        setSaved(false)
        try {
            await apiClient.updateProfile({
                name: name.trim(),
                phone: phone.trim() || null,
                ...(showHomeBoard ? { orgUnitId: orgUnitId === '' ? null : orgUnitId } : {}),
            })
            setSaved(true)
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'Your details could not be saved.'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <ErrorNotice title="Not saved" message={error} />}
            {saved && <InfoNotice>Saved.</InfoNotice>}
            <div>
                <Label htmlFor="profile-name">Name</Label>
                <Input id="profile-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
            </div>
            <div>
                <Label htmlFor="profile-phone">Phone (optional)</Label>
                <Input
                    id="profile-phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    autoComplete="tel"
                    maxLength={20}
                />
            </div>
            {showHomeBoard && areas.length > 0 && (
                <div>
                    <Label htmlFor="profile-board">Home community board (optional)</Label>
                    <Select
                        id="profile-board"
                        value={orgUnitId}
                        onChange={(e) => setOrgUnitId(e.target.value === '' ? '' : Number(e.target.value))}
                    >
                        <option value="">None</option>
                        {areas.map((area) => (
                            <option key={area.id} value={area.id}>
                                {area.code} — {area.name}
                            </option>
                        ))}
                    </Select>
                </div>
            )}
            <div>
                <Button type="submit" disabled={busy || pending || name.trim().length < 2}>
                    {busy ? 'Saving…' : 'Save details'}
                </Button>
            </div>
        </form>
    )
}

/**
 * Change the password. Every other device is signed out as a result, and the
 * form says so before anyone presses the button.
 */
export function PasswordForm() {
    const [current, setCurrent] = useState('')
    const [next, setNext] = useState('')
    const [confirm, setConfirm] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [done, setDone] = useState(false)

    const mismatch = confirm.length > 0 && next !== confirm

    async function submit(event: React.FormEvent) {
        event.preventDefault()
        setBusy(true)
        setError(null)
        setDone(false)
        try {
            await apiClient.changePassword(current, next)
            setCurrent('')
            setNext('')
            setConfirm('')
            setDone(true)
        } catch (err) {
            setError(messageFrom(err, 'The password could not be changed.'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-4">
            <p className="text-base text-ink-mid">
                Changing it signs you out everywhere else — any other browser or phone where you are signed in will
                have to sign in again. This one stays signed in.
            </p>
            {error && <ErrorNotice title="Not changed" message={error} />}
            {done && <InfoNotice>Your password has been changed.</InfoNotice>}
            <div>
                <Label htmlFor="password-current">Current password</Label>
                <Input
                    id="password-current"
                    type="password"
                    value={current}
                    onChange={(e) => setCurrent(e.target.value)}
                    autoComplete="current-password"
                />
            </div>
            <div>
                <Label htmlFor="password-new">New password</Label>
                <Input
                    id="password-new"
                    type="password"
                    value={next}
                    onChange={(e) => setNext(e.target.value)}
                    autoComplete="new-password"
                    aria-describedby="password-new-hint"
                />
                <p id="password-new-hint" className="mt-1 text-sm text-ink-soft">
                    At least 8 characters.
                </p>
            </div>
            <div>
                <Label htmlFor="password-confirm">New password again</Label>
                <Input
                    id="password-confirm"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    aria-invalid={mismatch || undefined}
                />
                {mismatch && <p className="mt-1 text-sm text-stop">The two new passwords do not match.</p>}
            </div>
            <div>
                <Button type="submit" disabled={busy || !current || next.length < 8 || next !== confirm}>
                    {busy ? 'Changing…' : 'Change password'}
                </Button>
            </div>
        </form>
    )
}
