'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, CircleCheck, Compass, ImageIcon, Loader2, TriangleAlert, X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Textarea } from '@/components/ui/textarea'
import { EmptyState, ErrorBanner } from '@/components/shared/page-header'
import { DEADLINE_TONE, deadlineLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Job } from '@/types'

/**
 * The field worker's app.
 *
 * Built for a phone held in one hand, on a patchy connection, by someone
 * standing at the site — not sitting at a desk. So: big targets, one job per
 * card, plain language, exactly two actions. Everything an officer can do is
 * absent, because a worker genuinely cannot do it.
 */
function JobCard({ job, onChanged }: { job: Job; onChanged: () => void }) {
    const fileRef = useRef<HTMLInputElement>(null)
    const [mode, setMode] = useState<'none' | 'complete' | 'issue'>('none')
    const [note, setNote] = useState('')
    const [photo, setPhoto] = useState<File | null>(null)
    const [preview, setPreview] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const deadline = deadlineLabel(job.slaDueAt, true)

    useEffect(() => {
        return () => {
            if (preview) URL.revokeObjectURL(preview)
        }
    }, [preview])

    function choosePhoto(file: File | null) {
        if (preview) URL.revokeObjectURL(preview)
        setPhoto(file)
        setPreview(file ? URL.createObjectURL(file) : null)
    }

    function reset() {
        setMode('none')
        setNote('')
        choosePhoto(null)
        setError(null)
        if (fileRef.current) fileRef.current.value = ''
    }

    async function submit() {
        if (mode === 'complete' && !photo) {
            return setError('Take a photo of the finished work first.')
        }
        if (mode === 'issue' && note.trim().length < 5) {
            return setError('Say what is stopping the work.')
        }

        setSubmitting(true)
        setError(null)
        try {
            const form = new FormData()
            if (note) form.append('note', note)
            if (photo) form.append('photo', photo)

            if (mode === 'complete') await apiClient.completeJob(job.id, form)
            else await apiClient.reportJobIssue(job.id, form)

            reset()
            onChanged()
        } catch (err) {
            setError(messageFrom(err, 'Could not send that. Try again.'))
        } finally {
            setSubmitting(false)
        }
    }

    const mapsHref =
        job.latitude != null && job.longitude != null
            ? `https://www.google.com/maps/search/?api=1&query=${job.latitude},${job.longitude}`
            : null

    return (
        <Card className={cn('overflow-hidden', deadline.tone === 'overdue' && 'border-l-4 border-l-red-500')}>
            <div className="p-4">
                <div className="flex items-start gap-3">
                    <div
                        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-[color:var(--muted)] text-2xl"
                        aria-hidden
                    >
                        {job.category?.icon ?? '📋'}
                    </div>
                    <div className="min-w-0 flex-1">
                        <h3 className="text-base font-semibold leading-snug">{job.title}</h3>
                        <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono text-[color:var(--muted-foreground)]">
                                {job.referenceNo}
                            </span>
                            {job.sector && <span className="font-medium">Sector {job.sector.number}</span>}
                            <span className={cn('rounded px-1.5 py-0.5 font-medium', DEADLINE_TONE[deadline.tone])}>
                                {deadline.text}
                            </span>
                        </div>
                    </div>
                </div>

                <p className="mt-3 text-sm leading-relaxed">{job.description}</p>

                {(job.landmark || job.address) && (
                    <p className="mt-2 text-sm text-[color:var(--muted-foreground)]">
                        📍 {job.landmark ?? job.address}
                    </p>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                    {job.photoUrl && (
                        <Button asChild variant="outline" size="sm">
                            <a href={job.photoUrl} target="_blank" rel="noreferrer">
                                <ImageIcon />
                                See the reported problem
                            </a>
                        </Button>
                    )}
                    {mapsHref && (
                        <Button asChild variant="outline" size="sm">
                            <a href={mapsHref} target="_blank" rel="noreferrer">
                                <Compass />
                                Directions
                            </a>
                        </Button>
                    )}
                </div>

                {job.supervisor && (
                    <p className="mt-3 text-xs text-[color:var(--muted-foreground)]">
                        Reporting to {job.supervisor.fullName}
                        {job.supervisor.designationTitle && `, ${job.supervisor.designationTitle}`}
                    </p>
                )}
            </div>

            {/* Actions get their own band so they are reachable with a thumb. */}
            {mode === 'none' ? (
                <div className="flex gap-2 border-t border-[color:var(--border)] bg-[color:var(--muted)] p-3">
                    <Button onClick={() => setMode('complete')} className="h-12 flex-1">
                        <CircleCheck />
                        Work finished
                    </Button>
                    <Button onClick={() => setMode('issue')} variant="outline" className="h-12">
                        <TriangleAlert />
                        Problem
                    </Button>
                </div>
            ) : (
                <div className="space-y-3 border-t border-[color:var(--border)] bg-[color:var(--muted)] p-4">
                    {error && <ErrorBanner message={error} />}

                    <p className="text-sm font-medium">
                        {mode === 'complete' ? 'Report the work finished' : 'Report a problem'}
                    </p>

                    {mode === 'complete' && (
                        <div>
                            {preview ? (
                                <div className="relative w-fit">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={preview}
                                        alt="Photo of the finished work"
                                        className="h-36 w-auto rounded-lg border border-[color:var(--border)] object-cover"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => choosePhoto(null)}
                                        className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-white"
                                        aria-label="Remove photo"
                                    >
                                        <X className="h-3.5 w-3.5" />
                                    </button>
                                </div>
                            ) : (
                                <label
                                    htmlFor={`photo-${job.id}`}
                                    className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-6 text-center"
                                >
                                    <Camera className="h-7 w-7 text-amber-700" />
                                    <span className="mt-2 text-sm font-medium text-amber-900">
                                        Take a photo of the finished work
                                    </span>
                                    <span className="mt-0.5 text-xs text-amber-700">
                                        Your officer needs this to pass the job
                                    </span>
                                </label>
                            )}
                            <input
                                ref={fileRef}
                                id={`photo-${job.id}`}
                                type="file"
                                accept="image/*"
                                capture="environment"
                                className="sr-only"
                                onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
                            />
                        </div>
                    )}

                    <Textarea
                        rows={2}
                        maxLength={2000}
                        placeholder={
                            mode === 'complete'
                                ? 'What did you do? (optional)'
                                : 'What is stopping the work? e.g. need a JCB, area locked, material not available'
                        }
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                    />

                    <div className="flex gap-2">
                        <Button onClick={() => void submit()} className="h-12 flex-1" disabled={submitting}>
                            {submitting && <Loader2 className="animate-spin" />}
                            Send
                        </Button>
                        <Button onClick={reset} variant="outline" className="h-12">
                            Cancel
                        </Button>
                    </div>
                </div>
            )}
        </Card>
    )
}

export function WorkerJobsClient({
    jobs: initialJobs,
    scope,
}: {
    jobs: Job[]
    scope: 'active' | 'done'
}) {
    const router = useRouter()
    const [jobs, setJobs] = useState(initialJobs)

    // Keep in step when the server re-renders after a mutation.
    useEffect(() => setJobs(initialJobs), [initialJobs])

    async function reload() {
        try {
            const res = await apiClient.jobs(scope)
            setJobs(res.items)
        } catch {
            // Fall back to a full server round trip.
        }
        router.refresh()
    }

    if (jobs.length === 0) {
        return (
            <EmptyState
                icon={<CircleCheck className="h-10 w-10" />}
                title={scope === 'done' ? 'Nothing completed yet' : 'No jobs right now'}
                description={
                    scope === 'done'
                        ? 'Work you finish will be listed here.'
                        : 'Your officer has not allotted any work to you. New jobs appear here.'
                }
            />
        )
    }

    return (
        <div className="space-y-4">
            {jobs.map((job) => (
                <JobCard key={job.id} job={job} onChanged={() => void reload()} />
            ))}
        </div>
    )
}
