import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { ErrorBanner, PageHeader, Spinner } from '../components/ui'
import type { Category, Complaint, RoutingDecision } from '../lib/types'

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
 * legible demonstration of GCCE in the product.
 */
function RoutingResult({
  complaint,
  routing,
}: {
  complaint: Complaint
  routing: RoutingDecision
}) {
  return (
    <div className="animate-fade-up mx-auto max-w-2xl">
      <div className="card overflow-hidden">
        <div className="border-b border-emerald-100 bg-emerald-50 px-6 py-5">
          <div className="flex items-start gap-3">
            <span className="text-2xl" aria-hidden>
              ✅
            </span>
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
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Category
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-900">
                {complaint.category ? (
                  <>
                    {complaint.category.icon} {complaint.category.name}
                  </>
                ) : (
                  <span className="text-slate-500">Awaiting manual categorisation</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Department
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-900">
                {complaint.department?.name ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">Ward</dt>
              <dd className="mt-1 text-sm font-medium text-slate-900">
                {complaint.ward
                  ? `Ward ${complaint.ward.wardNumber} — ${complaint.ward.name}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Assigned to
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-900">
                {complaint.assignedTo?.fullName ?? (
                  <span className="text-amber-600">Pending assignment</span>
                )}
              </dd>
            </div>
          </div>

          <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-4">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-800">
              <span className="rounded bg-brand-600 px-1.5 py-0.5 text-[10px] text-white">
                GCCE
              </span>
              How this was routed
            </h3>
            <ul className="mt-3 space-y-2">
              {routing.reasons.map((reason, i) => (
                <li key={i} className="flex gap-2 text-sm leading-relaxed text-slate-700">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
                  {reason}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link to={`/complaints/${complaint.id}`} className="btn-primary">
              Track this complaint
            </Link>
            <Link to="/" className="btn-secondary">
              Back to my complaints
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function NewComplaint() {
  const navigate = useNavigate()
  const fileRef = useRef<HTMLInputElement>(null)

  const [categories, setCategories] = useState<Category[]>([])
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [categoryId, setCategoryId] = useState<number | null>(null)
  const [address, setAddress] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [geo, setGeo] = useState<GeoState>({ status: 'idle' })

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<{ complaint: Complaint; routing: RoutingDecision } | null>(
    null,
  )

  useEffect(() => {
    api.categories().then(setCategories).catch(() => setCategories([]))
  }, [])

  // Ask for location on mount: it materially improves routing accuracy, and a
  // denial is handled gracefully rather than blocking submission.
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
          message: 'Location unavailable — your registered ward will be used instead.',
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

  function onPhotoChange(file: File | null) {
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
      if (address) form.append('address', address)
      if (geo.status === 'found') {
        form.append('latitude', String(geo.lat))
        form.append('longitude', String(geo.lon))
      }
      if (photo) form.append('photo', photo)

      setResult(await api.fileComplaint(form))
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your complaint.')
    } finally {
      setSubmitting(false)
    }
  }

  if (result) return <RoutingResult complaint={result.complaint} routing={result.routing} />

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="File a complaint"
        description="Describe the issue and we will route it to the right department automatically."
      />

      <form onSubmit={submit} className="space-y-5">
        {error && <ErrorBanner message={error} />}

        <div className="card-pad space-y-4">
          <div>
            <label className="label" htmlFor="title">
              What is the problem?
            </label>
            <input
              id="title"
              required
              minLength={5}
              maxLength={200}
              className="field"
              placeholder="e.g. Street light not working near the park"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="description">
              Tell us more
            </label>
            <textarea
              id="description"
              required
              minLength={10}
              maxLength={4000}
              rows={4}
              className="field resize-y"
              placeholder="When did it start? How is it affecting people? You can write in English, Hindi or a mix."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <p className="hint">
              Write however is comfortable — English, Hindi or Hinglish all work.
            </p>
          </div>
        </div>

        <div className="card-pad">
          <p className="label">
            Category <span className="font-normal text-slate-400">(optional)</span>
          </p>
          <p className="mb-3 text-xs text-slate-500">
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
                  className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-all ${
                    selected
                      ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span className="text-lg" aria-hidden>
                    {c.icon}
                  </span>
                  <span className="text-xs font-medium leading-tight text-slate-800">{c.name}</span>
                </button>
              )
            })}
          </div>
        </div>

        <div className="card-pad space-y-4">
          <div>
            <label className="label" htmlFor="photo">
              Photo <span className="font-normal text-slate-400">(optional)</span>
            </label>

            {preview ? (
              <div className="relative w-fit">
                <img
                  src={preview}
                  alt="Selected complaint photo"
                  className="h-40 w-auto rounded-lg border border-slate-200 object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    onPhotoChange(null)
                    if (fileRef.current) fileRef.current.value = ''
                  }}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs text-white shadow hover:bg-slate-900"
                  aria-label="Remove photo"
                >
                  ✕
                </button>
              </div>
            ) : (
              <label
                htmlFor="photo"
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/30"
              >
                <span className="text-2xl" aria-hidden>
                  📷
                </span>
                <span className="mt-2 text-sm font-medium text-slate-700">Add a photo</span>
                <span className="mt-0.5 text-xs text-slate-500">JPEG, PNG or WebP up to 8 MB</span>
              </label>
            )}

            <input
              ref={fileRef}
              id="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic"
              className="sr-only"
              onChange={(e) => onPhotoChange(e.target.files?.[0] ?? null)}
            />
          </div>

          <div>
            <label className="label" htmlFor="address">
              Landmark or address <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <input
              id="address"
              className="field"
              maxLength={500}
              placeholder="e.g. Near Shahpura Lake, opposite the bus stop"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div
            className={`flex items-start gap-2 rounded-lg px-3 py-2.5 text-xs ${
              geo.status === 'found'
                ? 'bg-emerald-50 text-emerald-800'
                : geo.status === 'locating'
                  ? 'bg-slate-50 text-slate-600'
                  : 'bg-amber-50 text-amber-800'
            }`}
          >
            <span aria-hidden className="mt-px">
              {geo.status === 'found' ? '📍' : geo.status === 'locating' ? '⏳' : 'ℹ️'}
            </span>
            <span>
              {geo.status === 'found' &&
                `Location captured (${geo.lat.toFixed(4)}, ${geo.lon.toFixed(4)}) — GCCE will use it to identify your ward.`}
              {geo.status === 'locating' && 'Getting your location…'}
              {geo.status === 'denied' && geo.message}
              {geo.status === 'idle' && 'Location not requested yet.'}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting && <Spinner />}
            {submitting ? 'Submitting…' : 'Submit complaint'}
          </button>
          <button type="button" onClick={() => navigate('/')} className="btn-secondary">
            Cancel
          </button>
        </div>
      </form>
    </div>
  )
}
