'use client'

import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Camera, CircleCheck, Info, Loader2, MapPin, X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { ErrorBanner, PageHeader } from '@/components/shared/page-header'
import { cn } from '@/lib/utils'
import type { Category, Complaint, RoutingDecision } from '@/types'

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
 */
function RoutingResult({
    complaint,
    routing,
}: {
    complaint: Complaint
    routing: RoutingDecision
}) {
    return (
        <div className="mx-auto max-w-2xl">
            <Card className="overflow-hidden">
                <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-5">
                    <div className="flex items-start gap-3">
                        <CircleCheck className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
                        <div>
                            <h2 className="font-semibold text-emerald-900">Complaint registered</h2>
                            <p className="mt-0.5 text-sm text-emerald-800">
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
                                    <span className="text-amber-600">Awaiting posting</span>
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

export function NewComplaintClient({ categories }: { categories: Category[] }) {
    const router = useRouter()
    const fileRef = useRef<HTMLInputElement>(null)

    const [title, setTitle] = useState('')
    const [description, setDescription] = useState('')
    const [categoryId, setCategoryId] = useState<number | null>(null)
    const [landmark, setLandmark] = useState('')
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
            if (categoryId != null) form.append('categoryId', String(categoryId))
            if (landmark) form.append('landmark', landmark)
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

    if (result) return <RoutingResult complaint={result.complaint} routing={result.routing} />

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

                <Card className="p-5">
                    <Label>
                        Category <span className="font-normal opacity-60">(optional)</span>
                    </Label>
                    <p className="mb-3 text-xs text-[color:var(--muted-foreground)]">
                        Leave this blank and GCCE will work it out from your description.
                    </p>

                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {categories.map((c) => {
                            const selected = categoryId === c.id
                            return (
                                <button
                                    key={c.id}
                                    type="button"
                                    onClick={() => setCategoryId(selected ? null : c.id)}
                                    aria-pressed={selected}
                                    className={cn(
                                        'flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all',
                                        selected
                                            ? 'border-[color:var(--primary)] bg-[color:var(--accent)] ring-1 ring-[color:var(--primary)]'
                                            : 'border-[color:var(--border)] hover:border-[color:var(--input)] hover:bg-[color:var(--muted)]',
                                    )}
                                >
                                    <span className="text-lg" aria-hidden>
                                        {c.icon}
                                    </span>
                                    <span className="text-xs font-medium leading-tight">{c.name}</span>
                                </button>
                            )
                        })}
                    </div>
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
                                ? 'bg-emerald-50 text-emerald-800'
                                : geo.status === 'locating'
                                  ? 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]'
                                  : 'bg-amber-50 text-amber-800',
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
