import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import Timeline from '../components/Timeline'
import {
  CardSkeleton,
  ErrorBanner,
  PriorityPill,
  SectionHeading,
  Spinner,
  StatusPill,
} from '../components/ui'
import { deadlineLabel, formatDateTime, isOpen, isSeniorOfficer } from '../lib/format'
import type { ComplaintDetail as Detail } from '../lib/types'

function FeedbackForm({ complaintId, onDone }: { complaintId: number; onDone: () => void }) {
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (rating === 0) return setError('Please choose a rating first.')
    setSubmitting(true)
    setError(null)
    try {
      await api.submitFeedback(complaintId, rating, comment || undefined)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit your feedback.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <ErrorBanner message={error} />}

      <div>
        <p className="label">How satisfied are you with the resolution?</p>
        <div className="flex gap-1" onMouseLeave={() => setHovered(0)}>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setRating(n)}
              onMouseEnter={() => setHovered(n)}
              className="text-2xl transition-transform hover:scale-110"
              aria-label={`${n} out of 5`}
            >
              <span className={n <= (hovered || rating) ? 'opacity-100' : 'opacity-25'}>⭐</span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor="comment">
          Anything to add? <span className="font-normal text-slate-400">(optional)</span>
        </label>
        <textarea
          id="comment"
          rows={2}
          maxLength={1000}
          className="field resize-y"
          placeholder="Was the work done properly?"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </div>

      <button type="submit" className="btn-primary" disabled={submitting}>
        {submitting && <Spinner />}
        Submit feedback
      </button>
    </form>
  )
}

export default function ComplaintDetail() {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const [complaint, setComplaint] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [closing, setClosing] = useState(false)

  async function load() {
    if (!id) return
    setLoading(true)
    setError(null)
    try {
      setComplaint(await api.complaint(Number(id)))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load this complaint.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [id])

  async function closeComplaint() {
    if (!complaint) return
    setClosing(true)
    try {
      await api.closeComplaint(complaint.id)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not close this complaint.')
    } finally {
      setClosing(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <CardSkeleton rows={4} />
        <CardSkeleton rows={6} />
      </div>
    )
  }

  if (error || !complaint) {
    return (
      <div className="space-y-4">
        <ErrorBanner message={error ?? 'Complaint not found.'} onRetry={() => void load()} />
        <Link to="/" className="btn-secondary">
          Back
        </Link>
      </div>
    )
  }

  const open = isOpen(complaint.status)
  const deadline = deadlineLabel(complaint.slaDueAt, open)
  const isOwner = complaint.citizen?.id === user?.id
  const canRate =
    isOwner &&
    complaint.feedbackRating == null &&
    (complaint.status === 'RESOLVED' || complaint.status === 'CLOSED')

  return (
    <div>
      <Link to="/" className="mb-4 inline-flex items-center gap-1 text-sm text-slate-600 hover:text-brand-600">
        ← Back
      </Link>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <div className="card-pad">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="font-mono text-xs text-slate-400">{complaint.referenceNo}</p>
                <h1 className="mt-1 text-xl font-bold leading-tight text-slate-900">
                  {complaint.title}
                </h1>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                <StatusPill status={complaint.status} />
                <PriorityPill priority={complaint.priority} />
              </div>
            </div>

            <p className="mt-4 whitespace-pre-wrap leading-relaxed text-slate-700">
              {complaint.description}
            </p>

            {complaint.photoUrl && (
              <a
                href={complaint.photoUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 block w-fit overflow-hidden rounded-lg border border-slate-200 transition-shadow hover:shadow-lift"
              >
                <img
                  src={complaint.photoUrl}
                  alt="Photo submitted with the complaint"
                  className="max-h-72 w-auto object-cover"
                />
              </a>
            )}

            {complaint.address && (
              <p className="mt-4 flex items-start gap-2 text-sm text-slate-600">
                <span aria-hidden>📍</span>
                {complaint.address}
              </p>
            )}
          </div>

          <div className="card-pad">
            <SectionHeading title="Progress" description="Every step, and who took it." />
            <Timeline history={complaint.history} />
          </div>

          {canRate && (
            <div className="card-pad">
              <SectionHeading title="Rate the resolution" />
              <FeedbackForm complaintId={complaint.id} onDone={() => void load()} />
            </div>
          )}

          {complaint.feedbackRating != null && (
            <div className="card-pad">
              <SectionHeading title="Your feedback" />
              <p className="text-lg">
                {'⭐'.repeat(complaint.feedbackRating)}
                <span className="opacity-25">{'⭐'.repeat(5 - complaint.feedbackRating)}</span>
              </p>
              {complaint.feedbackComment && (
                <p className="mt-2 text-sm text-slate-600">{complaint.feedbackComment}</p>
              )}
            </div>
          )}
        </div>

        <aside className="space-y-5">
          <div className="card-pad">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Details
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Category</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {complaint.category ? (
                    <>
                      {complaint.category.icon} {complaint.category.name}
                    </>
                  ) : (
                    <span className="text-slate-400">Not categorised</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Department</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {complaint.department?.name ?? '—'}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Sector</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {complaint.sector ? `Sector ${complaint.sector.number}` : '—'}
                  {complaint.sector?.circle && (
                    <span className="block text-xs font-normal text-slate-500">
                      {complaint.sector.circle.name}
                      {complaint.sector.circle.zone && ` · ${complaint.sector.circle.zone.name}`}
                    </span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Officer responsible</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {complaint.assignedOfficer?.fullName ?? (
                    <span className="text-amber-600">Awaiting posting</span>
                  )}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Crew on the job</dt>
                <dd className="mt-0.5 font-medium text-slate-900">
                  {complaint.assignedWorker?.fullName ?? (
                    <span className="text-slate-400">Not yet allotted</span>
                  )}
                </dd>
              </div>
              {isSeniorOfficer(user?.rank ?? 'CITIZEN') && complaint.citizen && (
                <div>
                  <dt className="text-slate-500">Filed by</dt>
                  <dd className="mt-0.5 font-medium text-slate-900">
                    {complaint.citizen.fullName}
                  </dd>
                </div>
              )}
            </dl>
          </div>

          <div className="card-pad">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
              Timing
            </h2>
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-slate-500">Filed</dt>
                <dd className="mt-0.5 text-slate-900">{formatDateTime(complaint.createdAt)}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Target resolution</dt>
                <dd
                  className={`mt-0.5 font-medium ${
                    deadline.tone === 'overdue'
                      ? 'text-red-600'
                      : deadline.tone === 'urgent'
                        ? 'text-amber-600'
                        : 'text-slate-900'
                  }`}
                >
                  {complaint.slaDueAt ? formatDateTime(complaint.slaDueAt) : '—'}
                  {open && complaint.slaDueAt && (
                    <span className="ml-1 font-normal">({deadline.text})</span>
                  )}
                </dd>
              </div>
              {complaint.resolvedAt && (
                <div>
                  <dt className="text-slate-500">Resolved</dt>
                  <dd className="mt-0.5 text-slate-900">{formatDateTime(complaint.resolvedAt)}</dd>
                </div>
              )}
            </dl>
          </div>

          {isSeniorOfficer(user?.rank ?? 'CITIZEN') && complaint.status === 'RESOLVED' && (
            <div className="card-pad">
              <h2 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                Sign-off
              </h2>
              <p className="mb-3 text-sm text-slate-600">
                The Section Officer has accepted the work. Closing is yours to authorise.
              </p>
              <button onClick={closeComplaint} className="btn-primary w-full" disabled={closing}>
                {closing && <Spinner />}
                Verify and close
              </button>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
