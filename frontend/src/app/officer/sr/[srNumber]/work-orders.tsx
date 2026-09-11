'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ErrorNotice } from '@/components/shared/notices'
import { messageFrom } from '@/lib/api-error'
import { formatDateTime, relativeTime } from '@/lib/format'
import { layer1Client } from '@/lib/layer1-api'
import type { IssuedWorkOrder, WorkOrderState, WorkOrderView } from '@/types/layer1'

/**
 * The job's link as a QR.
 *
 * On a white ground whatever the theme: a QR is read by a camera, not a person,
 * and a dark-mode inversion is a code many phone scanners will not read.
 */
function QrImage({ code, dataUrl }: { code: string; dataUrl: string }) {
    return (
        // A generated data URI, not a remote image — nothing for next/image to optimise.
        // eslint-disable-next-line @next/next/no-img-element
        <img
            src={dataUrl}
            alt={`QR code that opens job ${code}`}
            width={160}
            height={160}
            className="rounded-[var(--radius)] border border-line bg-white p-1"
        />
    )
}

const STATE: Record<WorkOrderState, { label: string; tone: 'wait' | 'done' | 'neutral' | 'stop' }> = {
    ISSUED: { label: 'With the crew', tone: 'wait' },
    COMPLETED: { label: 'Reported done', tone: 'done' },
    CANCELLED: { label: 'Withdrawn', tone: 'neutral' },
    EXPIRED: { label: 'Code expired', tone: 'stop' },
}

/**
 * Jobs sent to the street for this request.
 *
 * A work order is addressed to a crew with no account: the code is the whole
 * credential, printed or sent as a link. "Reported done" is the crew's claim
 * and deliberately does not close the request — the officer does that, through
 * the ordinary status change, because Layer 1 cannot verify the work happened.
 * Verifying it is Layer 4.
 *
 * Expiry is shown against the reader's own clock, unlike every date on the
 * record: whether a credential still works is a question about now, not about
 * the snapshot NYC's data was observed at.
 */
export function WorkOrderPanel({
    requestId,
    workOrders,
    canIssue,
}: {
    requestId: number
    workOrders: WorkOrderView[]
    canIssue: boolean
}) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const [instructions, setInstructions] = useState('')
    const [issued, setIssued] = useState<IssuedWorkOrder | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function issue(event: React.FormEvent) {
        event.preventDefault()
        setError(null)
        setBusy(true)
        try {
            const order = await layer1Client.issueWorkOrder(requestId, instructions.trim() || undefined)
            setIssued(order)
            setInstructions('')
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'The work order could not be issued.'))
        } finally {
            setBusy(false)
        }
    }

    async function cancel(code: string) {
        setError(null)
        try {
            await layer1Client.cancelWorkOrder(code)
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'The work order could not be withdrawn.'))
        }
    }

    const [shown, setShown] = useState<{ code: string; dataUrl: string } | null>(null)

    async function showQr(code: string) {
        if (shown?.code === code) return setShown(null)
        setError(null)
        try {
            const qr = await layer1Client.qr(code)
            setShown({ code, dataUrl: qr.qrDataUrl })
        } catch (err) {
            setError(messageFrom(err, 'The QR code could not be loaded.'))
        }
    }

    const hasLive = workOrders.some((w) => w.state === 'ISSUED')

    return (
        <div className="flex flex-col gap-3">
            <span className="label-cap">Work orders</span>
            {error && <ErrorNotice title="Something went wrong" message={error} />}

            {issued && (
                <div className="flex flex-col gap-1 rounded-[var(--radius)] border border-new/35 bg-new-soft px-3 py-2">
                    <span className="text-sm text-ink-mid">Give the crew this code, or send the link:</span>
                    <span className="mono text-2xl font-semibold tracking-wider text-ink">{issued.code}</span>
                    <QrImage code={issued.code} dataUrl={issued.qrDataUrl} />
                    <a href={issued.link} className="mono break-all text-sm text-brand underline">
                        {issued.link}
                    </a>
                    <span className="text-sm text-ink-soft">
                        Works until {formatDateTime(issued.expiresAt)} — {relativeTime(issued.expiresAt)}.
                    </span>
                </div>
            )}

            {workOrders.length === 0 ? (
                <p className="text-sm text-ink-soft">No job has been sent out on this request.</p>
            ) : (
                <ul className="flex flex-col divide-y divide-line rounded-[var(--radius)] border border-line">
                    {workOrders.map((order) => (
                        <li key={order.id} className="flex flex-col gap-1 px-3 py-2">
                            <div className="flex flex-wrap items-center gap-3">
                                <span className="mono font-semibold text-ink">{order.code}</span>
                                <Badge tone={STATE[order.state].tone}>{STATE[order.state].label}</Badge>
                                {order.state === 'ISSUED' && canIssue && (
                                    <>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="quiet"
                                            onClick={() => showQr(order.code)}
                                        >
                                            {shown?.code === order.code ? 'Hide QR' : 'Show QR'}
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            variant="quiet"
                                            disabled={pending}
                                            onClick={() => cancel(order.code)}
                                        >
                                            Withdraw
                                        </Button>
                                    </>
                                )}
                            </div>
                            {shown?.code === order.code && (
                                <QrImage code={order.code} dataUrl={shown.dataUrl} />
                            )}
                            {order.instructions && (
                                <span className="text-sm text-ink-mid">{order.instructions}</span>
                            )}
                            <span className="text-sm text-ink-soft">
                                Issued {formatDateTime(order.issuedAt)}
                                {order.state === 'ISSUED' && ` · expires ${relativeTime(order.expiresAt)}`}
                                {order.completedAt && ` · reported done ${formatDateTime(order.completedAt)}`}
                            </span>
                            {order.completionNote && (
                                <span className="text-sm text-ink-mid">
                                    Crew&rsquo;s note: &ldquo;{order.completionNote}&rdquo;
                                </span>
                            )}
                        </li>
                    ))}
                </ul>
            )}

            {canIssue && !hasLive && (
                <form onSubmit={issue} className="flex flex-col gap-2">
                    <div>
                        <Label htmlFor="wo-instructions">Instructions for the crew (optional)</Label>
                        <Textarea
                            id="wo-instructions"
                            rows={2}
                            maxLength={1000}
                            value={instructions}
                            disabled={busy}
                            placeholder="What the crew should find, and what to do about it"
                            onChange={(event) => setInstructions(event.target.value)}
                        />
                    </div>
                    <div>
                        <Button type="submit" disabled={busy}>
                            {busy ? 'Issuing…' : 'Issue work order'}
                        </Button>
                    </div>
                </form>
            )}
            {canIssue && hasLive && (
                <p className="text-sm text-ink-soft">
                    A job is already out with a crew. Withdraw it to send a new one.
                </p>
            )}
        </div>
    )
}
