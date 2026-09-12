'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ErrorNotice } from '@/components/shared/notices'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { messageFrom } from '@/lib/api-error'
import { layer4Client } from '@/lib/layer4-api'

/**
 * The resident's answer.
 *
 * Two buttons and no form, because the person answering is being asked about
 * something they can see out of the window. Their answer outranks every
 * automated check, so it is asked plainly and recorded as given.
 */
export function CitizenVerdict({ workOrderId }: { workOrderId: number }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState<string | null>(null)

    async function answer(confirmed: boolean) {
        setBusy(true)
        setError(null)
        try {
            await layer4Client.citizenVerdict(workOrderId, confirmed)
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'That could not be recorded.'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            {error && <ErrorNotice title="Could not record your answer" message={error} />}
            <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => answer(true)} disabled={busy || pending}>
                    Yes, it has been done
                </Button>
                <Button type="button" variant="outline" onClick={() => answer(false)} disabled={busy || pending}>
                    No, it has not
                </Button>
            </div>
        </div>
    )
}

/**
 * The officer's decision on work a resident disputed, or that nobody vouched for.
 *
 * Refusing needs a sentence: the job goes back to the crew carrying it, and
 * "rejected" with no reason is how a crew learns nothing and returns with the
 * same photograph.
 */
export function DecideProof({ workOrderId }: { workOrderId: number }) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [busy, setBusy] = useState(false)
    const [refusing, setRefusing] = useState(false)
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)

    async function decide(accept: boolean) {
        setBusy(true)
        setError(null)
        try {
            await layer4Client.decide(workOrderId, accept, accept ? undefined : note.trim())
            setRefusing(false)
            setNote('')
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'That could not be recorded.'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col gap-2">
            {error && <ErrorNotice title="Could not record the decision" message={error} />}
            {refusing ? (
                <div className="flex flex-col gap-2">
                    <div>
                        <Label htmlFor={`refuse-${workOrderId}`}>What should the crew put right?</Label>
                        <Textarea
                            id={`refuse-${workOrderId}`}
                            rows={2}
                            maxLength={1000}
                            value={note}
                            disabled={busy}
                            onChange={(event) => setNote(event.target.value)}
                        />
                    </div>
                    <div className="flex gap-2">
                        <Button
                            type="button"
                            onClick={() => decide(false)}
                            disabled={busy || pending || note.trim().length < 5}
                        >
                            Send it back
                        </Button>
                        <Button type="button" variant="quiet" onClick={() => setRefusing(false)} disabled={busy}>
                            Cancel
                        </Button>
                    </div>
                </div>
            ) : (
                <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => decide(true)} disabled={busy || pending}>
                        Accept the work
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setRefusing(true)} disabled={busy}>
                        Send it back
                    </Button>
                </div>
            )}
        </div>
    )
}
