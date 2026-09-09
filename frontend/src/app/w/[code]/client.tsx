'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
    Camera,
    CheckCircle2,
    ChevronRight,
    Loader2,
    MapPin,
    Phone,
    TriangleAlert,
    UserRound,
    X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { WorkerShell } from '../shell'

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1'

interface Check {
    check: string
    label: string
    passed: boolean
    detail: string
}

interface Job {
    code: string
    status: string
    expired: boolean
    acceptsSubmission: boolean
    job: {
        title: string
        what: string
        instructions: string | null
        category: { name: string; nameHi: string | null; icon: string } | null
        department: { name: string; icon: string } | null
        sector: { number: number; name: string } | null
        landmark: string | null
        address: string | null
        latitude: number | null
        longitude: number | null
        referencePhotoUrl: string | null
        priority: string
        dueAt: string | null
    }
    assignedTo: { fullName: string; trade: string } | null
    supervisor: { fullName: string; phone: string | null }
    submissions: { id: number; note: string | null; submittedAt: string; files: { id: number; url: string; kind: string }[] }[]
    /** Issued on the first open of this code, and only then. See deviceKey. */
    deviceToken?: string
    assurance?: 'NONE' | 'DEVICE_BOUND' | 'OTP_VERIFIED'
}

interface SubmitResult {
    accepted: boolean
    score: number
    outcome: string
    checks: Check[]
    message: string
}

/**
 * Built for the actual conditions: a five-year-old Android, one hand, bright
 * sun, a patchy connection, and somebody who has never seen this screen before
 * and will not see it again for a week.
 *
 * So: one column, large type, one obvious action, and no vocabulary borrowed
 * from the rest of the platform. There is no "complaint", no "SLA", no
 * "verification pipeline" — there is a job, a place, and a photo to send back.
 */
export function WorkerPortal({ code }: { code: string }) {
    const [job, setJob] = useState<Job | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const [files, setFiles] = useState<File[]>([])
    const [previews, setPreviews] = useState<string[]>([])
    const [note, setNote] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [result, setResult] = useState<SubmitResult | null>(null)
    const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
    const [selfie, setSelfie] = useState<File | null>(null)
    const [selfiePreview, setSelfiePreview] = useState<string | null>(null)

    const fileRef = useRef<HTMLInputElement>(null)

    /**
     * The token that ties this job to this phone.
     *
     * Issued by the server the first time the code is opened and kept in
     * localStorage, so the phone that took the slip is recognisably the phone
     * that sends the work back. It is not a login and it never blocks anything
     * — losing it only means the submission is recorded as unverified.
     */
    const deviceKey = `drishti-w-${code}`

    useEffect(() => {
        void (async () => {
            try {
                let held: string | null = null
                try {
                    held = localStorage.getItem(deviceKey)
                } catch {
                    // Private browsing and locked-down phones both throw here.
                    // Nothing downstream depends on it.
                }

                const url = new URL(`${API}/work/${encodeURIComponent(code)}`)
                if (held) url.searchParams.set('device', held)

                const res = await fetch(url)
                if (!res.ok) {
                    const body = await res.json().catch(() => null)
                    throw new Error(body?.error ?? 'That code did not work.')
                }

                const loaded: Job = await res.json()
                if (loaded.deviceToken) {
                    try {
                        localStorage.setItem(deviceKey, loaded.deviceToken)
                    } catch {
                        // See above — a phone that cannot store it simply
                        // submits at the lower assurance level.
                    }
                }
                setJob(loaded)
            } catch (err) {
                setError(err instanceof Error ? err.message : 'Could not open that job.')
            } finally {
                setLoading(false)
            }
        })()
    }, [code])

    // Location is a nice-to-have, never a gate: plenty of these phones will
    // refuse, and a worker must not be blocked because of it.
    useEffect(() => {
        if (!navigator.geolocation) return
        navigator.geolocation.getCurrentPosition(
            (pos) => setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            () => undefined,
            { timeout: 8000 },
        )
    }, [])

    useEffect(() => {
        return () => previews.forEach((p) => URL.revokeObjectURL(p))
    }, [previews])

    useEffect(() => {
        return () => {
            if (selfiePreview) URL.revokeObjectURL(selfiePreview)
        }
    }, [selfiePreview])

    function addFiles(list: FileList | null) {
        if (!list) return
        const picked = Array.from(list).slice(0, 5 - files.length)
        setFiles((f) => [...f, ...picked])
        setPreviews((p) => [
            ...p,
            ...picked.map((f) => (f.type.startsWith('image/') ? URL.createObjectURL(f) : '')),
        ])
    }

    function removeFile(index: number) {
        if (previews[index]) URL.revokeObjectURL(previews[index]!)
        setFiles((f) => f.filter((_, i) => i !== index))
        setPreviews((p) => p.filter((_, i) => i !== index))
    }

    async function submit(e: FormEvent) {
        e.preventDefault()
        setSubmitting(true)
        setError(null)
        try {
            const form = new FormData()
            files.forEach((f) => form.append('files', f))
            if (selfie) form.append('selfie', selfie)
            if (note) form.append('note', note)
            try {
                const held = localStorage.getItem(deviceKey)
                if (held) form.append('device', held)
            } catch {
                // Unreadable storage just means a weaker assurance level.
            }
            if (coords) {
                form.append('latitude', String(coords.lat))
                form.append('longitude', String(coords.lon))
            }

            const res = await fetch(`${API}/work/${encodeURIComponent(code)}/submit`, {
                method: 'POST',
                body: form,
            })
            const body = await res.json()
            if (!res.ok) throw new Error(body?.error ?? 'Could not send that.')
            setResult(body)
            window.scrollTo({ top: 0, behavior: 'smooth' })
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not send that.')
        } finally {
            setSubmitting(false)
        }
    }

    // --- states -------------------------------------------------------------

    if (loading) {
        return (
            <WorkerShell>
                <div className="flex items-center justify-center gap-3 py-24 text-[color:var(--muted-foreground)]">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Opening your job…
                </div>
            </WorkerShell>
        )
    }

    if (error && !job) {
        return (
            <WorkerShell>
                <div className="rounded-2xl border-2 border-[color:var(--error-border)] bg-[color:var(--error-bg)] px-5 py-8 text-center">
                    <TriangleAlert className="mx-auto h-10 w-10 text-[color:var(--error)]" aria-hidden />
                    <h1 className="mt-4 text-lg font-bold text-[color:var(--error-fg)]">{error}</h1>
                    <p className="mt-2 text-sm text-[color:var(--error-fg)]">
                        Check the code on your slip, or ring your officer for a new one.
                    </p>
                </div>
            </WorkerShell>
        )
    }

    if (!job) return null

    if (result) {
        return (
            <WorkerShell>
                <div
                    className={cn(
                        'rounded-2xl border-2 px-5 py-8 text-center',
                        result.accepted
                            ? 'border-[color:var(--success-border)] bg-[color:var(--success-bg)]'
                            : 'border-[color:var(--warning-border)] bg-[color:var(--warning-bg)]',
                    )}
                >
                    {result.accepted ? (
                        <CheckCircle2 className="mx-auto h-12 w-12 text-[color:var(--success)]" aria-hidden />
                    ) : (
                        <TriangleAlert className="mx-auto h-12 w-12 text-[color:var(--warning)]" aria-hidden />
                    )}
                    <h1
                        className={cn(
                            'mt-4 text-xl font-bold',
                            result.accepted ? 'text-[color:var(--success-fg)]' : 'text-[color:var(--warning-fg)]',
                        )}
                    >
                        {result.accepted ? 'Sent. Thank you.' : 'This could not be accepted'}
                    </h1>
                    <p
                        className={cn(
                            'mt-2 text-base',
                            result.accepted ? 'text-[color:var(--success-fg)]' : 'text-[color:var(--warning-fg)]',
                        )}
                    >
                        {result.message}
                    </p>
                </div>

                {/* Shown either way. A worker whose proof was refused is owed the
                    reason, and one whose proof passed deserves to see it did. */}
                <section className="mt-5">
                    <h2 className="mb-2 text-sm font-semibold text-[color:var(--foreground)]">What was checked</h2>
                    <ul className="space-y-2">
                        {result.checks.map((c) => (
                            <li
                                key={c.check}
                                className="flex items-start gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] px-4 py-3"
                            >
                                <span
                                    aria-hidden
                                    className={cn(
                                        'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
                                        c.passed ? 'bg-[color:var(--success)]' : 'bg-[color:var(--border-strong)]',
                                    )}
                                >
                                    {c.passed ? '✓' : '!'}
                                </span>
                                <span className="min-w-0">
                                    <span className="block text-sm font-medium text-[color:var(--foreground)]">
                                        {c.label}
                                    </span>
                                    <span className="mt-0.5 block text-sm text-[color:var(--muted-foreground)]">
                                        {c.detail}
                                    </span>
                                </span>
                            </li>
                        ))}
                    </ul>
                </section>

                {!result.accepted && (
                    <button
                        onClick={() => {
                            setResult(null)
                            setFiles([])
                            setPreviews([])
                        }}
                        className="mt-5 w-full rounded-xl bg-slate-900 px-5 py-4 text-base font-semibold text-white"
                    >
                        Take another photo and try again
                    </button>
                )}
            </WorkerShell>
        )
    }

    const j = job.job

    return (
        <WorkerShell>
            <p className="text-xs font-semibold uppercase tracking-wider text-[color:var(--muted-foreground)]">
                Job {job.code}
            </p>
            <h1 className="mt-1 text-2xl font-bold leading-tight text-[color:var(--foreground)]">{j.title}</h1>

            {job.assignedTo && (
                <p className="mt-2 text-base text-[color:var(--muted-foreground)]">
                    For <span className="font-semibold text-[color:var(--foreground)]">{job.assignedTo.fullName}</span>
                </p>
            )}

            {/* Where. First, and big — it is the only thing that matters before
                arriving, and it is what a worker checks while walking. */}
            <div className="mt-5 rounded-2xl border-2 border-slate-900 bg-[color:var(--card)] px-4 py-4">
                <div className="flex items-start gap-3">
                    <MapPin className="mt-0.5 h-6 w-6 shrink-0 text-[color:var(--foreground)]" aria-hidden />
                    <div className="min-w-0">
                        <p className="text-lg font-bold leading-tight text-[color:var(--foreground)]">
                            {j.sector ? `Sector ${j.sector.number}` : 'Sector not recorded'}
                        </p>
                        {(j.landmark || j.address) && (
                            <p className="mt-0.5 text-base text-[color:var(--foreground)]">{j.landmark ?? j.address}</p>
                        )}
                    </div>
                </div>
                {j.latitude != null && j.longitude != null && (
                    <a
                        href={`https://www.google.com/maps/search/?api=1&query=${j.latitude},${j.longitude}`}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-base font-semibold text-white"
                    >
                        Open in Maps
                        <ChevronRight className="h-4 w-4" aria-hidden />
                    </a>
                )}
            </div>

            <section className="mt-5">
                <h2 className="text-sm font-semibold text-[color:var(--foreground)]">What has been reported</h2>
                <p className="mt-1 whitespace-pre-line text-base leading-relaxed text-[color:var(--foreground)]">
                    {j.what}
                </p>

                {j.instructions && (
                    <p className="mt-3 rounded-xl bg-[color:var(--warning-bg)] px-4 py-3 text-base text-[color:var(--warning-fg)]">
                        <span className="font-semibold">From your officer: </span>
                        {j.instructions}
                    </p>
                )}

                {j.referencePhotoUrl && (
                    <figure className="mt-3">
                        <figcaption className="mb-1 text-sm text-[color:var(--muted-foreground)]">
                            Photo sent by the resident
                        </figcaption>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={j.referencePhotoUrl}
                            alt="What was reported"
                            className="w-full rounded-xl border border-[color:var(--border)]"
                        />
                    </figure>
                )}
            </section>

            {!job.acceptsSubmission ? (
                <div className="mt-6 rounded-2xl border-2 border-[color:var(--border)] bg-[color:var(--sunken)] px-5 py-6 text-center">
                    <p className="text-base font-semibold text-[color:var(--foreground)]">
                        {job.expired ? 'This code has expired.' : 'This job has already been sent in.'}
                    </p>
                    <p className="mt-1 text-sm text-[color:var(--muted-foreground)]">
                        Ring {job.supervisor.fullName} if something is still wrong here.
                    </p>
                </div>
            ) : (
                <form onSubmit={submit} className="mt-6">
                    <h2 className="text-lg font-bold text-[color:var(--foreground)]">When you have finished</h2>
                    <p className="mt-1 text-base text-[color:var(--muted-foreground)]">
                        Take a photo of the finished work. Take it here at the site — the system
                        checks when and where it was taken.
                    </p>

                    {error && (
                        <p className="mt-3 rounded-xl bg-[color:var(--error-bg)] px-4 py-3 text-base text-[color:var(--error-fg)]">
                            {error}
                        </p>
                    )}

                    <div className="mt-4 grid grid-cols-3 gap-2">
                        {files.map((file, index) => (
                            <div key={index} className="relative">
                                {previews[index] ? (
                                    // eslint-disable-next-line @next/next/no-img-element
                                    <img
                                        src={previews[index]}
                                        alt=""
                                        className="h-24 w-full rounded-xl border border-[color:var(--border)] object-cover"
                                    />
                                ) : (
                                    <div className="flex h-24 w-full items-center justify-center rounded-xl border border-[color:var(--border)] bg-[color:var(--muted)] px-2 text-center text-xs text-[color:var(--muted-foreground)]">
                                        {file.name.slice(0, 24)}
                                    </div>
                                )}
                                <button
                                    type="button"
                                    onClick={() => removeFile(index)}
                                    aria-label="Remove"
                                    className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-slate-900 text-white"
                                >
                                    <X className="h-4 w-4" />
                                </button>
                            </div>
                        ))}

                        {files.length < 5 && (
                            <label
                                htmlFor="proof"
                                className="flex h-24 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[color:var(--border-strong)] bg-[color:var(--card)] text-[color:var(--muted-foreground)]"
                            >
                                <Camera className="h-6 w-6" aria-hidden />
                                <span className="mt-1 text-xs font-medium">Add photo</span>
                            </label>
                        )}
                    </div>

                    <input
                        ref={fileRef}
                        id="proof"
                        type="file"
                        // `capture` opens the camera straight away on a phone,
                        // which is where these come from.
                        capture="environment"
                        accept="image/*,video/*,application/pdf"
                        multiple
                        className="sr-only"
                        onChange={(e) => addFiles(e.target.files)}
                    />

                    {/* Optional, and said plainly.
                        Nobody here has an account, so the only thing tying this
                        job to a person is the name the officer wrote on the
                        slip. A face gives the officer something to check it
                        against. It is never required — a worker who does not
                        want to be photographed still gets their work recorded. */}
                    <div className="mt-5 rounded-xl border border-[color:var(--border)] bg-[color:var(--sunken)] p-4">
                        <div className="flex items-start gap-3">
                            {selfiePreview ? (
                                <div className="relative shrink-0">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={selfiePreview}
                                        alt="Your photo"
                                        className="h-20 w-20 rounded-xl border border-[color:var(--border)] object-cover"
                                    />
                                    <button
                                        type="button"
                                        aria-label="Remove your photo"
                                        onClick={() => {
                                            if (selfiePreview) URL.revokeObjectURL(selfiePreview)
                                            setSelfie(null)
                                            setSelfiePreview(null)
                                        }}
                                        className="absolute -right-1.5 -top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-[color:var(--foreground)] text-[color:var(--card)]"
                                    >
                                        <X className="h-4 w-4" />
                                    </button>
                                </div>
                            ) : (
                                <label
                                    htmlFor="selfie"
                                    className="flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-[color:var(--border-strong)] bg-[color:var(--card)] text-[color:var(--muted-foreground)]"
                                >
                                    <UserRound className="h-6 w-6" aria-hidden />
                                    <span className="mt-1 text-[10px] font-medium">Add</span>
                                </label>
                            )}

                            <div className="min-w-0">
                                <p className="text-base font-medium text-[color:var(--foreground)]">
                                    A photo of you{' '}
                                    <span className="font-normal text-[color:var(--muted-foreground)]">
                                        (optional)
                                    </span>
                                </p>
                                <p className="mt-0.5 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                                    So your officer can see the job was done by the person it was
                                    given to. You can send the work without it.
                                </p>
                            </div>
                        </div>
                    </div>

                    <input
                        id="selfie"
                        type="file"
                        // The front camera, since this is a photograph of the
                        // person holding the phone.
                        capture="user"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                            const picked = e.target.files?.[0]
                            if (!picked) return
                            if (selfiePreview) URL.revokeObjectURL(selfiePreview)
                            setSelfie(picked)
                            setSelfiePreview(URL.createObjectURL(picked))
                        }}
                    />

                    <label htmlFor="note" className="mt-5 block text-base font-medium text-[color:var(--foreground)]">
                        Anything to add? <span className="font-normal text-[color:var(--muted-foreground)]">(optional)</span>
                    </label>
                    <textarea
                        id="note"
                        rows={3}
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        placeholder="e.g. Nali saaf kar di, malba utha diya"
                        className="mt-1 w-full rounded-xl border-2 border-[color:var(--border-strong)] px-4 py-3 text-base"
                    />

                    <button
                        type="submit"
                        disabled={submitting || (files.length === 0 && !note)}
                        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--success)] px-5 py-4 text-lg font-bold text-white disabled:opacity-50"
                    >
                        {submitting && <Loader2 className="h-5 w-5 animate-spin" />}
                        {submitting ? 'Sending…' : 'Send — work done'}
                    </button>
                </form>
            )}

            <div className="mt-8 border-t border-[color:var(--border)] pt-4">
                <p className="text-sm text-[color:var(--muted-foreground)]">Your officer for this job</p>
                <p className="mt-0.5 text-base font-semibold text-[color:var(--foreground)]">
                    {job.supervisor.fullName}
                </p>
                {job.supervisor.phone && (
                    <a
                        href={`tel:${job.supervisor.phone}`}
                        className="mt-2 inline-flex items-center gap-2 rounded-xl border-2 border-[color:var(--border-strong)] px-4 py-2.5 text-base font-semibold text-[color:var(--foreground)]"
                    >
                        <Phone className="h-4 w-4" aria-hidden />
                        {job.supervisor.phone}
                    </a>
                )}
            </div>
        </WorkerShell>
    )
}
