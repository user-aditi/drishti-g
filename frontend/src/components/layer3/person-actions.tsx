'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorNotice, InfoNotice } from '@/components/shared/notices'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { messageFrom } from '@/lib/api-error'
import { layer3Client } from '@/lib/layer3-api'
import type { HandedOn } from '@/types/layer3'

type Option = { id: number; code: string; name: string }

/** What happened to an officer's open requests, in a sentence. */
function handedOnSentence(tally: HandedOn | null): string | null {
    if (!tally) return null
    const parts = [
        tally.reassigned > 0 && `${tally.reassigned} handed to another officer`,
        tally.unassigned > 0 && `${tally.unassigned} left unassigned for the supervisor`,
        tally.kept > 0 && `${tally.kept} still theirs`,
    ].filter(Boolean)
    return parts.length === 0 ? 'They had no open requests.' : `Their open requests: ${parts.join(', ')}.`
}

/**
 * Move someone to a new post.
 *
 * The reason is required because it goes on the audit chain, and a transfer
 * with no recorded reason is the kind of change an audit exists to question.
 */
export function MovePostingForm({
    userId,
    agencies,
    units,
    current,
}: {
    userId: number
    agencies: Option[]
    units: (Option & { depth: number })[]
    current: { agencyId: number | null; orgUnitId: number | null }
}) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [agencyId, setAgencyId] = useState(String(current.agencyId ?? agencies[0]?.id ?? ''))
    const [orgUnitId, setOrgUnitId] = useState(String(current.orgUnitId ?? units[0]?.id ?? ''))
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [done, setDone] = useState<string | null>(null)

    async function submit(event: React.FormEvent) {
        event.preventDefault()
        setBusy(true)
        setError(null)
        setDone(null)
        try {
            const result = await layer3Client.movePosting(userId, {
                agencyId: Number(agencyId),
                orgUnitId: Number(orgUnitId),
                reason: reason.trim(),
            })
            setReason('')
            setDone(['Moved.', handedOnSentence(result.requests)].filter(Boolean).join(' '))
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'The posting could not be changed.'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            {error && <ErrorNotice title="Could not move them" message={error} />}
            {done && <InfoNotice>{done}</InfoNotice>}
            <div className="flex flex-wrap gap-3">
                <div className="flex flex-col gap-1">
                    <Label htmlFor="move-agency">Agency</Label>
                    <Select
                        id="move-agency"
                        value={agencyId}
                        onChange={(event) => setAgencyId(event.target.value)}
                        className="w-44"
                    >
                        {agencies.map((agency) => (
                            <option key={agency.id} value={agency.id}>
                                {agency.code}
                            </option>
                        ))}
                    </Select>
                </div>
                <div className="flex flex-col gap-1">
                    <Label htmlFor="move-unit">Post</Label>
                    <Select
                        id="move-unit"
                        value={orgUnitId}
                        onChange={(event) => setOrgUnitId(event.target.value)}
                        className="w-64"
                    >
                        {units.map((unit) => (
                            <option key={unit.id} value={unit.id}>
                                {unit.code} · {unit.name}
                            </option>
                        ))}
                    </Select>
                </div>
            </div>
            <div>
                <Label htmlFor="move-reason">Why</Label>
                <Textarea
                    id="move-reason"
                    rows={2}
                    maxLength={500}
                    value={reason}
                    placeholder="Recorded on the audit chain"
                    onChange={(event) => setReason(event.target.value)}
                />
            </div>
            <div>
                <Button type="submit" disabled={busy || pending || reason.trim().length < 5}>
                    {busy ? 'Moving…' : 'Move to this post'}
                </Button>
            </div>
        </form>
    )
}

/** Switch an account off, or back on. */
export function AccountAccessForm({ userId, isActive, name }: { userId: number; isActive: boolean; name: string }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [reason, setReason] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [done, setDone] = useState<string | null>(null)

    async function submit(event: React.FormEvent) {
        event.preventDefault()
        setBusy(true)
        setError(null)
        setDone(null)
        try {
            const result = await layer3Client.setActive(userId, { active: !isActive, reason: reason.trim() })
            setReason('')
            setDone(
                [isActive ? `${name} can no longer sign in.` : `${name} can sign in again.`, handedOnSentence(result.requests)]
                    .filter(Boolean)
                    .join(' '),
            )
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'The account could not be changed.'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            {error && <ErrorNotice title="Could not change the account" message={error} />}
            {done && <InfoNotice>{done}</InfoNotice>}
            <div>
                <Label htmlFor="access-reason">Why</Label>
                <Textarea
                    id="access-reason"
                    rows={2}
                    maxLength={500}
                    value={reason}
                    placeholder="Recorded on the audit chain"
                    onChange={(event) => setReason(event.target.value)}
                />
            </div>
            <div>
                <Button
                    type="submit"
                    variant={isActive ? 'danger' : 'primary'}
                    disabled={busy || pending || reason.trim().length < 5}
                >
                    {busy ? 'Saving…' : isActive ? 'Deactivate this account' : 'Reactivate this account'}
                </Button>
            </div>
        </form>
    )
}
