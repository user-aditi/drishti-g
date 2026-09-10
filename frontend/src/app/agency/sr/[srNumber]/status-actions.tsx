'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { STATUSES, STATUS_META } from '@/lib/constants'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNotice } from '@/components/shared/notices'
import type { RequestStatus } from '@/types'

/**
 * The only write an agent can make in Layer 0.
 *
 * Moving a request between the statuses NYC publishes, with a resolution note —
 * and nothing else. There is no assign control, no escalate button and no
 * priority: none of those exist in 311's data, and adding one here would put a
 * concept of ours inside the baseline the later layers are supposed to be
 * measured against.
 *
 * The note is what NYC's `resolution_description` is: the agency's own account
 * of what it did. On an imported request that text is already New York's, and
 * writing over it is a real edit to a historical record — so the control says
 * so rather than presenting an empty box.
 */
export function StatusActions({
    requestId,
    current,
    isImported,
    hasNote,
}: {
    requestId: number
    current: RequestStatus
    isImported: boolean
    hasNote: boolean
}) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [status, setStatus] = useState<RequestStatus>(current)
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)

    const unchanged = status === current
    const willOverwrite = isImported && hasNote && note.trim().length > 0

    async function submit(event: React.FormEvent) {
        event.preventDefault()
        if (unchanged) return
        setError(null)
        setSaving(true)
        try {
            await apiClient.setStatus(requestId, status, note.trim() || undefined)
            setNote('')
            // The server holds the record; re-render from it rather than
            // patching a copy here, so the timeline and the audit entry the API
            // just wrote are both reflected.
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'The status could not be changed.'))
        } finally {
            setSaving(false)
        }
    }

    const busy = saving || pending

    return (
        <form onSubmit={submit} className="flex flex-col gap-3">
            {error && <ErrorNotice title="Could not update" message={error} />}

            <div>
                <Label htmlFor="status">Status</Label>
                <Select
                    id="status"
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
                <Label htmlFor="note">Resolution note</Label>
                <Textarea
                    id="note"
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
                {willOverwrite && (
                    <p className="mt-2 text-[13.5px] text-wait">
                        This request already carries the resolution text New York published.
                        Saving a note replaces it.
                    </p>
                )}
            </div>

            <div className="flex items-center gap-3">
                <Button type="submit" disabled={busy || unchanged}>
                    {busy ? 'Saving…' : 'Change status'}
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
