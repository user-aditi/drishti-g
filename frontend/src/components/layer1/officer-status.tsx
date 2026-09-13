'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorNotice } from '@/components/shared/notices'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { messageFrom } from '@/lib/api-error'
import { STATUSES, STATUS_META } from '@/lib/constants'
import { layer1Client } from '@/lib/layer1-api'
import type { RequestStatus } from '@/types'

/**
 * The status control, for the person who answers for the request. Layer 1.
 *
 * Until Phase 9 this did not exist: the officer could send a crew, receive its
 * photographs and accept the work, and then had to find an agent to close the
 * request the work was for. It writes through the same transition as the
 * agent's control, so the history and the audit entry are identical whoever
 * closes it.
 *
 * When a crew has reported the job done, their note is offered as the
 * resolution — offered, not filled in, because the resolution is the agency's
 * statement about the problem and the officer should decide to make it.
 */
export function OfficerStatus({
    requestId,
    current,
    isImported,
    hasNote,
    crewNote,
}: {
    requestId: number
    current: RequestStatus
    isImported: boolean
    hasNote: boolean
    /** The most recent crew's completion note, if one reported the job done. */
    crewNote: string | null
}) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [status, setStatus] = useState<RequestStatus>(current === 'CLOSED' ? current : 'CLOSED')
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const unchanged = status === current
    const willOverwrite = isImported && hasNote && note.trim().length > 0
    const busy = saving || pending

    async function submit(event: React.FormEvent) {
        event.preventDefault()
        if (unchanged) return
        setError(null)
        setSaving(true)
        try {
            await layer1Client.setStatus(requestId, status, note.trim() || undefined)
            setNote('')
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'The status could not be changed.'))
        } finally {
            setSaving(false)
        }
    }

    return (
        <form id="status" onSubmit={submit} className="flex flex-col gap-3">
            {error && <ErrorNotice title="Could not update" message={error} />}

            <div>
                <Label htmlFor="officer-status">Status</Label>
                <Select
                    id="officer-status"
                    value={status}
                    disabled={busy}
                    onChange={(event) => setStatus(event.target.value as RequestStatus)}
                >
                    {STATUSES.map((value) => (
                        <option key={value} value={value}>
                            {STATUS_META[value].label}
                            {value === current ? ' (current)' : ''}
                        </option>
                    ))}
                </Select>
            </div>

            <div>
                <Label htmlFor="officer-note">Resolution note</Label>
                <Textarea
                    id="officer-note"
                    value={note}
                    disabled={busy}
                    rows={3}
                    maxLength={2000}
                    placeholder={
                        isImported && hasNote
                            ? 'Leave blank to keep New York’s own account of this request'
                            : 'What was done, in the agency’s words'
                    }
                    onChange={(event) => setNote(event.target.value)}
                />
                {crewNote && note.trim() === '' && (
                    <button
                        type="button"
                        className="mt-2 text-[13.5px] text-brand underline underline-offset-2"
                        onClick={() => setNote(crewNote)}
                    >
                        Use the crew’s note: “{crewNote.length > 80 ? `${crewNote.slice(0, 80)}…` : crewNote}”
                    </button>
                )}
                {willOverwrite && (
                    <p className="mt-2 text-[13.5px] text-wait">
                        This request already carries the resolution text New York published. Saving a note
                        replaces it.
                    </p>
                )}
            </div>

            <div className="flex items-center gap-3">
                <Button type="submit" disabled={busy || unchanged}>
                    {busy ? 'Saving…' : status === 'CLOSED' ? 'Close this request' : 'Change status'}
                </Button>
                {unchanged && (
                    <span className="text-[13.5px] text-ink-soft">
                        Already {STATUS_META[current].label.toLowerCase()}.
                    </span>
                )}
            </div>
        </form>
    )
}
