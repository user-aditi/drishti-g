'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorNotice } from '@/components/shared/notices'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { messageFrom } from '@/lib/api-error'
import { layer2Client } from '@/lib/layer2-api'

/**
 * Say "I have this" to a rung that reached you, with what happens next.
 *
 * An escalation nobody acknowledges looks exactly like one nobody read. The note
 * is required because the officer, and anyone above, act on it: "looking into
 * it" tells them nothing, so the API wants at least a short sentence.
 */
export function AcknowledgeControl({ escalationId, srNumber }: { escalationId: number; srNumber: string }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [open, setOpen] = useState(false)
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const fieldId = `acknowledge-${escalationId}`

    async function submit(event: React.FormEvent) {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try {
            await layer2Client.acknowledge(escalationId, note.trim())
            setOpen(false)
            setNote('')
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'The escalation could not be acknowledged.'))
        } finally {
            setBusy(false)
        }
    }

    if (!open) {
        return (
            <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(true)}
                aria-label={`Acknowledge the escalation of ${srNumber}`}
            >
                Acknowledge
            </Button>
        )
    }

    return (
        <form onSubmit={submit} className="flex min-w-64 flex-col gap-2">
            {error && <ErrorNotice title="Could not acknowledge" message={error} />}
            <div>
                <Label htmlFor={fieldId}>What happens next?</Label>
                <Textarea
                    id={fieldId}
                    // The form appears because someone asked for it; the note is what they came to write.
                    autoFocus
                    rows={2}
                    maxLength={1000}
                    value={note}
                    disabled={busy || pending}
                    placeholder="Who is doing what, and by when"
                    onChange={(event) => setNote(event.target.value)}
                />
            </div>
            <div className="flex gap-2">
                <Button type="submit" size="sm" disabled={busy || pending || note.trim().length < 5}>
                    {busy ? 'Saving…' : 'Acknowledge'}
                </Button>
                <Button type="button" size="sm" variant="quiet" onClick={() => setOpen(false)} disabled={busy}>
                    Cancel
                </Button>
            </div>
        </form>
    )
}
