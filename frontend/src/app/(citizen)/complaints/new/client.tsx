'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Camera, CircleCheck, Info, Loader2, MapPin, Users, X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ErrorBanner, PageHeader } from '@/components/shared/page-header'
import { SupportButton } from '@/components/citizen/support-button'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Category, Complaint, RoutingDecision, SimilarIssue } from '@/types'

type GeoState =
    | { status: 'idle' }
    | { status: 'locating' }
    | { status: 'found'; lat: number; lon: number }
    | { status: 'denied'; message: string }

/**
 * Shown after a successful submission.
 *
 * The point is not the confirmation — it is showing the citizen that a real
 * decision was made about their complaint, and what it was. This is the most
 * legible demonstration of GCCE anywhere in the product.
 *
 * It is also the only place a citizen touches the category, and deliberately
 * so: they are asked to check an answer, never to supply one. Asking up front
 * would mean asking someone to know the difference between Public Health and
 * Jal Vibhag — and it would fill the routing history with their guesses instead
 * of with what the engine decided, which is the one signal that would let the
 * engine improve.
 */
function RoutingResult({
    complaint: initialComplaint,
    routing: initialRouting,
    categories,
}: {
    complaint: Complaint
    routing: RoutingDecision
    categories: Category[]
}) {
    const [complaint, setComplaint] = useState(initialComplaint)
    const [routing, setRouting] = useState(initialRouting)
    const [answer, setAnswer] = useState<'unanswered' | 'confirmed' | 'corrected'>('unanswered')
    const [correcting, setCorrecting] = useState(false)
    const [saving, setSaving] = useState<number | 'unsure' | null>(null)
    const [correctionError, setCorrectionError] = useState<string | null>(null)

    async function correctTo(categoryId: number | null) {
        setSaving(categoryId ?? 'unsure')
        setCorrectionError(null)
        try {
            const res = await apiClient.confirmCategory(complaint.id, categoryId)
            setComplaint(res.complaint)
            setRouting(res.routing)
            setAnswer('corrected')
            setCorrecting(false)
        } catch (err) {
            setCorrectionError(messageFrom(err, 'Could not move this complaint.'))
        } finally {
            setSaving(null)
        }
    }

    return (
        <div className="mx-auto max-w-2xl">
            <Card className="overflow-hidden">
                <div className="border-b border-emerald-100 bg-[color:var(--success-bg)] px-6 py-5">
                    <div className="flex items-start gap-3">
                        <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-[color:var(--success)]" />
                        <div>
                            <h2 className="font-semibold text-[color:var(--success-fg)]">Complaint registered</h2>
                            <p className="mt-0.5 text-sm text-[color:var(--success-fg)]">
                                Your reference number is{' '}
                                <span className="font-mono font-semibold">{complaint.referenceNo}</span>
                            </p>
                        </div>
                    </div>
                </div>

                <div className="space-y-5 p-6">
                    <dl className="grid gap-4 sm:grid-cols-2">
                        <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                                Category
                            </dt>
                            <dd className="mt-1 text-sm font-medium">
                                {complaint.category ? (
                                    <>
                                        {complaint.category.icon} {complaint.category.name}
                                    </>
                                ) : (
                                    <span className="text-[color:var(--muted-foreground)]">
                                        Awaiting manual categorisation
                                    </span>
                                )}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                                Department
                            </dt>
                            <dd className="mt-1 text-sm font-medium">{complaint.department?.name ?? '—'}</dd>
                        </div>
                        <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                                Sector
                            </dt>
                            <dd className="mt-1 text-sm font-medium">
                                {complaint.sector ? `Sector ${complaint.sector.number}` : '—'}
                            </dd>
                        </div>
                        <div>
                            <dt className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                                Officer responsible
                            </dt>
                            <dd className="mt-1 text-sm font-medium">
                                {complaint.assignedOfficer?.fullName ?? (
                                    <span className="text-[color:var(--warning)]">Awaiting posting</span>
                                )}
                            </dd>
                        </div>
                    </dl>

                    <div className="rounded-lg border border-[color:var(--accent)] bg-[color:var(--accent)]/50 p-4">
                        <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--accent-foreground)]">
                            <span className="rounded bg-[color:var(--primary)] px-1.5 py-0.5 text-[10px] text-white">
                                GCCE
                            </span>
                            How this was routed
                        </h3>
                        <ul className="mt-3 space-y-2">
                            {routing.reasons.map((reason, i) => (
                                <li key={i} className="flex gap-2 text-sm leading-relaxed">
                                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[color:var(--primary)]" />
                                    {reason}
                                </li>
                            ))}
                        </ul>
                    </div>

                    <CategoryCheck
                        complaint={complaint}
                        categories={categories}
                        answer={answer}
                        correcting={correcting}
                        saving={saving}
                        error={correctionError}
                        onConfirm={() => setAnswer('confirmed')}
                        onStartCorrecting={() => setCorrecting(true)}
                        onCancelCorrecting={() => setCorrecting(false)}
                        onCorrect={correctTo}
                    />

                    <div className="flex flex-wrap gap-2">
                        <Button asChild>
                            <Link href={`/complaints/${complaint.id}`}>Track this complaint</Link>
                        </Button>
                        <Button asChild variant="outline">
                            <Link href="/dashboard">Back to my complaints</Link>
                        </Button>
                    </div>
                </div>
            </Card>
        </div>
    )
}

/**
 * "We have sent this to Electrical — is that right?"
 *
 * Three states, in the order a person meets them: the question, the correction
 * grid if they say no, and a settled line once they have answered either way.
 * It is asked once and never nags — a citizen who ignores it has still filed a
 * complaint, and the routing stands.
 */
function CategoryCheck({
    complaint,
    categories,
    answer,
    correcting,
    saving,
    error,
    onConfirm,
    onStartCorrecting,
    onCancelCorrecting,
    onCorrect,
}: {
    complaint: Complaint
    categories: Category[]
    answer: 'unanswered' | 'confirmed' | 'corrected'
    correcting: boolean
    saving: number | 'unsure' | null
    error: string | null
    onConfirm: () => void
    onStartCorrecting: () => void
    onCancelCorrecting: () => void
    onCorrect: (categoryId: number | null) => void
}) {
    if (answer !== 'unanswered') {
        return (
            <p className="flex items-center gap-2 text-sm text-[color:var(--muted-foreground)]">
                <CircleCheck className="h-4 w-4 shrink-0 text-[color:var(--success)]" aria-hidden />
                {answer === 'corrected'
                    ? 'Moved — the officer shown above is the one who now has it.'
                    : 'Thank you. Confirming helps the system route the next one better.'}
            </p>
        )
    }

    if (correcting) {
        return (
            <div className="rounded-lg border border-[color:var(--border)] p-4">
                <h3 className="text-sm font-semibold">What is it, then?</h3>
                <p className="mb-3 mt-0.5 text-xs text-[color:var(--muted-foreground)]">
                    Choosing here moves the complaint, and the officer responsible changes with it.
                </p>

                {error && <p className="mb-3 text-xs text-[color:var(--error)]">{error}</p>}

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {categories
                        .filter((c) => c.id !== complaint.category?.id)
                        .map((c) => (
                            <button
                                key={c.id}
                                type="button"
                                disabled={saving !== null}
                                onClick={() => onCorrect(c.id)}
                                className={cn(
                                    'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all',
                                    'border-[color:var(--border)] hover:border-[color:var(--primary)] hover:bg-[color:var(--muted)]',
                                    'disabled:cursor-not-allowed disabled:opacity-50',
                                )}
                            >
                                <span className="text-lg" aria-hidden>
                                    {saving === c.id ? <Loader2 className="h-4 w-4 animate-spin" /> : c.icon}
                                </span>
                                <span className="text-xs font-medium leading-tight">{c.name}</span>
                            </button>
                        ))}
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={saving !== null}
                        onClick={() => onCorrect(null)}
                    >
                        {saving === 'unsure' && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                        I am not sure
                    </Button>
                    <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={saving !== null}
                        onClick={onCancelCorrecting}
                    >
                        Cancel
                    </Button>
                </div>
            </div>
        )
    }

    return (
        <div className="rounded-lg border border-[color:var(--info-border)] bg-[color:var(--info-bg)]/60 p-4">
            <div className="flex items-start gap-2.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--info-fg)]" aria-hidden />
                <div className="min-w-0 flex-1">
                    <h3 className="text-sm font-semibold text-[color:var(--info-fg)]">
                        {complaint.department
                            ? `We have sent this to ${complaint.department.name}. Is that right?`
                            : 'We could not work out which department this belongs to.'}
                    </h3>
                    <p className="mt-0.5 text-xs text-[color:var(--info-fg)]">
                        {complaint.department
                            ? 'You do not have to answer — your complaint is filed either way. But telling us when it is wrong is what stops the next one going astray.'
                            : 'Somebody will categorise it by hand. If you know what it is, you can say so now and it will go straight there.'}
                    </p>

                    <div className="mt-3 flex flex-wrap gap-2">
                        {complaint.department && (
                            <Button type="button" size="sm" onClick={onConfirm}>
                                Yes, that is right
                            </Button>
                        )}
                        <Button
                            type="button"
                            size="sm"
                            variant={complaint.department ? 'outline' : 'default'}
                            onClick={onStartCorrecting}
                        >
                            {complaint.department ? 'No — it is something else' : 'Tell us what it is'}
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export function NewComplaintClient({ categories }: { categories: Category[] }) {
    const router = useRouter()
    const fileRef = useRef<HTMLInputElement>(null)

    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [landmark, setLandmark] = useState('')
    const [isCommunity, setIsCommunity] = useState(false)
    const [similar, setSimilar] = useState<SimilarIssue[]>([])
    const [photo, setPhoto] = useState<File | null>(null)
    const [preview, setPreview] = useState<string | null>(null)
    const [geo, setGeo] = useState<GeoState>({ status: 'idle' })

    const [error, setError] = useState<string | null>(null)
    const [submitting, setSubmitting] = useState(false)
    const [result, setResult] = useState<{ complaint: Complaint; routing: RoutingDecision } | null>(
        null,
    )

    // Ask for location on mount: it materially improves routing accuracy, and a
    // refusal is handled gracefully rather than blocking submission.
    useEffect(() => {
        if (!navigator.geolocation) {
            setGeo({ status: 'denied', message: 'This browser cannot share a location.' })
            return
        }
        setGeo({ status: 'locating' })
        navigator.geolocation.getCurrentPosition(
            (pos) => setGeo({ status: 'found', lat: pos.coords.latitude, lon: pos.coords.longitude }),
            () =>
                setGeo({
                    status: 'denied',
                    message: 'Location unavailable — your registered sector will be used instead.',
                }),
            { timeout: 8000 },
        )
    }, [])

    /**
     * Look for open issues nearby that match what is being typed.
     *
     * Debounced, and never blocking: the point is to offer backing an existing
     * grievance as the better option, not to argue with someone who is certain
     * their problem is its own. Runs on the title only — by the time a person
     * is writing detail they have decided.
     */
    useEffect(() => {
        if (title.trim().length < 6) {
            setSimilar([])
            return
        }
        const timer = setTimeout(async () => {
            try {
                const res = await apiClient.similarNearby({ q: title })
                setSimilar(res.items)
            } catch {
                // A failed suggestion lookup must never stand between a citizen
                // and filing their complaint.
                setSimilar([])
            }
        }, 500)
        return () => clearTimeout(timer)
    }, [title])

    // Revoke the object URL when the preview changes, or the blob leaks.
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

    async function submit(e: FormEvent) {
        e.preventDefault()
        setError(null)
        setSubmitting(true)

        try {
            const form = new FormData()
            form.append('title', title)
            form.append('description', description)
            if (landmark) form.append('landmark', landmark)
            if (isCommunity) form.append('isCommunity', 'true')
            if (geo.status === 'found') {
                form.append('latitude', String(geo.lat))
                form.append('longitude', String(geo.lon))
            }
            if (photo) form.append('photo', photo)

            setResult(await apiClient.fileComplaint(form))
            window.scrollTo({ top: 0, behavior: 'smooth' })
            // The dashboard is a server component; tell Next its data is stale.
            router.refresh()
        } catch (err) {
            setError(messageFrom(err, 'Could not submit your complaint.'))
        } finally {
            setSubmitting(false)
        }
    }

    if (result)
        return (
            <RoutingResult
                complaint={result.complaint}
                routing={result.routing}
                categories={categories}
            />
        )

    return (
        <div className="mx-auto max-w-2xl">
            <PageHeader
                title="Report an issue"
                description="Describe what you have seen. GCCE works out the department, the sector and the officer responsible."
            />

            <form onSubmit={submit} className="space-y-5">
                {error && <ErrorBanner message={error} />}

                <Card className="space-y-4 p-5">
                    <div>
                        <Label htmlFor="title">What is the problem?</Label>
                        <Input
                            id="title"
                            required
                            minLength={5}
                            maxLength={200}
                            placeholder="e.g. Street light not working near the park"
                            value={title}
                            onChange={(e) => setTitle(e.target.value)}
                        />
                    </div>

                    <div>
                        <Label htmlFor="description">Tell us more</Label>
                        <Textarea
                            id="description"
                            required
                            minLength={10}
                            maxLength={4000}
                            rows={4}
                            placeholder="When did it start? How is it affecting people? You can write in English, Hindi or a mix."
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                        />
                        <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                            Write however is comfortable — English, Hindi or Hinglish all work.
                        </p>
                    </div>
                </Card>

                {similar.length > 0 && (
                    <Card className="border-[color:var(--info-border)] bg-[color:var(--info-bg)]/60 p-5">
                        <div className="flex items-start gap-2.5">
                            <Users className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--info-fg)]" aria-hidden />
                            <div className="min-w-0">
                                <h2 className="text-sm font-semibold text-[color:var(--info-fg)]">
                                    Someone nearby may have already reported this
                                </h2>
                                <p className="mt-0.5 text-xs text-[color:var(--info-fg)]">
                                    Backing an existing issue carries more weight than filing the
                                    same thing twice — one complaint with ten names behind it moves
                                    faster than ten separate ones.
                                </p>
                            </div>
                        </div>

                        <ul className="mt-3 space-y-2">
                            {similar.map((issue) => (
                                <li
                                    key={issue.id}
                                    className="rounded-lg border border-[color:var(--info-border)] bg-white px-3 py-2.5"
                                >
                                    <div className="flex flex-wrap items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <Link
                                                href={`/complaints/${issue.id}`}
                                                className="text-sm font-medium hover:underline"
                                            >
                                                {issue.category?.icon} {issue.title}
                                            </Link>
                                            <p className="text-xs text-[color:var(--muted-foreground)]">
                                                {issue.sector ? `Sector ${issue.sector.number}` : ''} ·
                                                reported {relativeTime(issue.createdAt)}
                                                {issue.supporters > 0 &&
                                                    ` · ${issue.supporters} backing it`}
                                            </p>
                                        </div>
                                        {issue.isCommunity ? (
                                            <SupportButton
                                                complaintId={issue.id}
                                                supporters={issue.supporters}
                                                hasSupported={issue.viewerHasSupported}
                                                canSupport
                                                nextThreshold={null}
                                            />
                                        ) : (
                                            <Badge variant="neutral">Private complaint</Badge>
                                        )}
                                    </div>
                                </li>
                            ))}
                        </ul>

                        <p className="mt-3 text-xs text-[color:var(--info-fg)]">
                            None of these? Carry on filling in the form below — yours will be filed
                            separately.
                        </p>
                    </Card>
                )}

                <Card className="p-5">
                    <label
                        htmlFor="isCommunity"
                        className={cn(
                            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
                            isCommunity
                                ? 'border-[color:var(--primary)] bg-[color:var(--accent)]'
                                : 'border-[color:var(--input)]',
                        )}
                    >
                        <input
                            id="isCommunity"
                            type="checkbox"
                            checked={isCommunity}
                            onChange={(e) => setIsCommunity(e.target.checked)}
                            className="mt-0.5 h-4 w-4 shrink-0 accent-[color:var(--primary)]"
                        />
                        <span className="min-w-0">
                            <span className="block text-sm font-medium">
                                This affects my whole neighbourhood, not just me
                            </span>
                            <span className="mt-0.5 block text-xs text-[color:var(--muted-foreground)]">
                                A dark lane, a choked drain, uncollected rubbish. Your neighbours
                                will be able to add their names to it, and enough support raises how
                                urgently the authority treats it. Leave this off for something
                                private to your own household.
                            </span>
                        </span>
                    </label>
                </Card>

                <Card className="space-y-4 p-5">
                    <div>
                        <Label htmlFor="photo">
                            Photo <span className="font-normal opacity-60">(optional)</span>
                        </Label>

                        {preview ? (
                            <div className="relative w-fit">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                    src={preview}
                                    alt="Selected complaint photo"
                                    className="h-40 w-auto rounded-lg border border-[color:var(--border)] object-cover"
                                />
                                <button
                                    type="button"
                                    onClick={() => {
                                        choosePhoto(null)
                                        if (fileRef.current) fileRef.current.value = ''
                                    }}
                                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-white shadow"
                                    aria-label="Remove photo"
                                >
                                    <X className="h-3 w-3" />
                                </button>
                            </div>
                        ) : (
                            <label
                                htmlFor="photo"
                                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[color:var(--input)] bg-[color:var(--muted)] px-4 py-8 text-center transition-colors hover:border-[color:var(--primary)]"
                            >
                                <Camera className="h-6 w-6 text-[color:var(--muted-foreground)]" />
                                <span className="mt-2 text-sm font-medium">Add a photo</span>
                                <span className="mt-0.5 text-xs text-[color:var(--muted-foreground)]">
                                    JPEG, PNG or WebP up to 8 MB
                                </span>
                            </label>
                        )}

                        <input
                            ref={fileRef}
                            id="photo"
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/heic"
                            className="sr-only"
                            onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
                        />
                    </div>

                    <div>
                        <Label htmlFor="landmark">
                            Landmark <span className="font-normal opacity-60">(optional)</span>
                        </Label>
                        <Input
                            id="landmark"
                            maxLength={200}
                            placeholder="e.g. Near the DPS gate, opposite the bus stop"
                            value={landmark}
                            onChange={(e) => setLandmark(e.target.value)}
                        />
                    </div>

                    <div
                        className={cn(
                            'flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs',
                            geo.status === 'found'
                                ? 'bg-[color:var(--success-bg)] text-[color:var(--success-fg)]'
                                : geo.status === 'locating'
                                  ? 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]'
                                  : 'bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]',
                        )}
                    >
                        {geo.status === 'found' ? (
                            <MapPin className="mt-px h-3.5 w-3.5 shrink-0" />
                        ) : geo.status === 'locating' ? (
                            <Loader2 className="mt-px h-3.5 w-3.5 shrink-0 animate-spin" />
                        ) : (
                            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
                        )}
                        <span>
                            {geo.status === 'found' &&
                                `Location captured (${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}) — GCCE will use it to identify your sector.`}
                            {geo.status === 'locating' && 'Getting your location…'}
                            {geo.status === 'denied' && geo.message}
                            {geo.status === 'idle' && 'Location not requested yet.'}
                        </span>
                    </div>
                </Card>

                <div className="flex flex-wrap gap-2">
                    <Button type="submit" disabled={submitting}>
                        {submitting && <Loader2 className="animate-spin" />}
                        {submitting ? 'Submitting…' : 'Submit complaint'}
                    </Button>
                    <Button type="button" variant="outline" asChild>
                        <Link href="/dashboard">Cancel</Link>
                    </Button>
                </div>
            </form>
        </div>
    )
}
