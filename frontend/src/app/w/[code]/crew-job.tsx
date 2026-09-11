'use client'

import { useEffect, useState } from 'react'
import { LayerMark, StaffName } from '@/components/layer1/marks'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { messageFrom } from '@/lib/api-error'
import { formatDateTime, relativeTime } from '@/lib/format'
import { layer1Client } from '@/lib/layer1-api'
import type { PublicWorkOrder } from '@/types/layer1'

/**
 * Built for the conditions it will actually be used in: a phone, one hand, a
 * poor connection, and somebody who has never seen this screen before.
 *
 * One column, large type, one action. None of the rest of the system's
 * vocabulary — no SLA, no board register, no status family — just the job,
 * where it is, and a way to say it is done. And nothing about who reported it:
 * a code that leaks should cost a junk report, not a resident's privacy.
 *
 * "Done" here is the crew's word. It is recorded against the job and shown to
 * the officer; it does not close the request, because nothing in this layer can
 * check it.
 */
export function CrewJob({ code }: { code: string }) {
    const [job, setJob] = useState<PublicWorkOrder | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [note, setNote] = useState('')
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)

    useEffect(() => {
        let cancelled = false
        layer1Client
            .workOrder(code)
            .then((result) => !cancelled && setJob(result))
            .catch((err: unknown) => !cancelled && setError(messageFrom(err, 'This job could not be opened.')))
        return () => {
            cancelled = true
        }
    }, [code])

    async function complete(event: React.FormEvent) {
        event.preventDefault()
        setBusy(true)
        setError(null)
        try {
            await layer1Client.complete(code, note.trim() || undefined)
            setDone(true)
        } catch (err) {
            setError(messageFrom(err, 'That could not be recorded. Try again.'))
        } finally {
            setBusy(false)
        }
    }

    if (error && !job) {
        return (
            <main className="mx-auto flex max-w-xl flex-col gap-4 px-4 py-10">
                <h1 className="text-2xl font-semibold text-ink">Job not found</h1>
                <p className="text-base text-ink-mid">{error}</p>
                <p className="mono text-lg text-ink-soft">{code}</p>
            </main>
        )
    }

    if (!job) {
        return (
            <main className="mx-auto max-w-xl px-4 py-10">
                <p className="text-base text-ink-soft">Opening the job…</p>
            </main>
        )
    }

    const reported = done || job.state === 'COMPLETED'

    return (
        <main className="mx-auto flex max-w-xl flex-col gap-6 px-4 py-8">
            <div className="flex flex-col gap-2">
                <div className="flex flex-wrap items-center gap-3">
                    <span className="mono text-xl font-semibold tracking-wider text-ink">{job.code}</span>
                    <LayerMark />
                </div>
                <h1 className="text-[24px] font-semibold leading-tight text-ink">{job.job.what}</h1>
                {job.job.detail && <p className="text-lg text-ink-mid">{job.job.detail}</p>}
            </div>

            <div className="flex flex-col gap-1 text-lg">
                <span className="label-cap">Where</span>
                <span className="text-ink">{job.job.address ?? 'No street address on the record'}</span>
                {job.job.board && (
                    <span className="text-base text-ink-soft">
                        {job.job.board.name} ({job.job.board.code}), Brooklyn
                    </span>
                )}
                {job.job.latitude !== null && job.job.longitude !== null && (
                    <a
                        className="text-base text-brand underline"
                        href={`https://www.openstreetmap.org/?mlat=${job.job.latitude}&mlon=${job.job.longitude}#map=18/${job.job.latitude}/${job.job.longitude}`}
                    >
                        Open the location on a map
                    </a>
                )}
            </div>

            {job.instructions && (
                <div className="flex flex-col gap-1">
                    <span className="label-cap">Instructions</span>
                    <p className="text-lg text-ink">{job.instructions}</p>
                </div>
            )}

            <div className="flex flex-col gap-1 text-base text-ink-mid">
                <span>
                    Sent by <StaffName name={job.issuedBy.name} isSynthetic={job.issuedBy.isSynthetic} />
                </span>
                <span className="mono text-sm text-ink-soft">SR {job.job.srNumber}</span>
            </div>

            {reported ? (
                <div className="rounded-[var(--radius)] border border-done/35 bg-done-soft px-4 py-3 text-lg text-done">
                    Reported done{job.completedAt ? ` on ${formatDateTime(job.completedAt)}` : ''}. The officer
                    will check it and close the request.
                </div>
            ) : job.state === 'EXPIRED' ? (
                <div className="rounded-[var(--radius)] border border-stop/35 bg-stop-soft px-4 py-3 text-lg text-stop">
                    This code has expired. Ask the officer for a new one.
                </div>
            ) : job.state === 'CANCELLED' ? (
                <div className="rounded-[var(--radius)] border border-line bg-sunk px-4 py-3 text-lg text-ink-mid">
                    The officer withdrew this job. There is nothing to do.
                </div>
            ) : (
                <form onSubmit={complete} className="flex flex-col gap-3">
                    <div>
                        <Label htmlFor="crew-note">Anything the officer should know? (optional)</Label>
                        <Textarea
                            id="crew-note"
                            rows={3}
                            maxLength={1000}
                            value={note}
                            disabled={busy}
                            onChange={(event) => setNote(event.target.value)}
                        />
                    </div>
                    <Button type="submit" size="lg" disabled={busy}>
                        {busy ? 'Sending…' : 'The job is done'}
                    </Button>
                    {error && <p className="text-base text-stop">{error}</p>}
                    <p className="text-sm text-ink-soft">
                        This code works until {formatDateTime(job.expiresAt)} ({relativeTime(job.expiresAt)}).
                    </p>
                </form>
            )}

            <p className="text-sm text-ink-soft">
                Part of an academic replica of NYC 311. Nothing reported here reaches the City of New York.
            </p>
        </main>
    )
}
