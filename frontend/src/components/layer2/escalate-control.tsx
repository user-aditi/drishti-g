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
 * Raise a request one rung by hand.
 *
 * Available before any breach — someone who can see a request going wrong
 * should not have to wait for its deadline — and never without a reason, because
 * the reason is what the person it reaches will act on. The API refuses fewer than
 * ten characters; the button stays disabled until there is something to send.
 */
export function EscalateControl({ requestId, nextLevelName }: { requestId: number; nextLevelName: string }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [reason, setReason] = useState('')
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function submit(event: React.FormEvent) {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try {
            await layer2Client.escalate(requestId, reason.trim())
            setReason('')
            setOpen(false)
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'The request could not be escalated.'))
        } finally {
            setBusy(false)
        }
    }

    if (!open) {
        return (
            <div>
                <Button type="button" variant="outline" onClick={() => setOpen(true)}>
                    Escalate to the {nextLevelName}
                </Button>
            </div>
        )
    }

    return (
        <form onSubmit={submit} className="flex flex-col gap-2">
            {error && <ErrorNotice title="Could not escalate" message={error} />}
            <div>
                <Label htmlFor="escalate-reason">Why does this need the {nextLevelName}?</Label>
                <Textarea
                    id="escalate-reason"
                    rows={3}
                    maxLength={1000}
                    value={reason}
                    disabled={busy || pending}
                    placeholder="What is blocking it, and what you need from them"
                    onChange={(event) => setReason(event.target.value)}
                />
            </div>
            <div className="flex gap-2">
                <Button type="submit" disabled={busy || pending || reason.trim().length < 10}>
                    {busy ? 'Escalating…' : `Escalate to the ${nextLevelName}`}
                </Button>
                <Button type="button" variant="quiet" onClick={() => setOpen(false)} disabled={busy}>
                    Cancel
                </Button>
            </div>
        </form>
    )
}
