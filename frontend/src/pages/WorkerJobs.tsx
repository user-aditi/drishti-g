import { useEffect, useRef, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { CardSkeleton, EmptyState, ErrorBanner, PageHeader, Spinner } from '../components/ui'
import { DEADLINE_TONE, deadlineLabel } from '../lib/format'
import type { Job } from '../lib/types'

/**
 * The field worker's app.
 *
 * Built for a phone held in one hand, on a patchy connection, by someone who is
 * standing at the site — not sitting at a desk. So: big targets, one job per
 * card, plain language, and exactly two actions. Everything an officer can do
 * is absent because a worker genuinely cannot do it.
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

      if (mode === 'complete') await api.completeJob(job.id, form)
      else await api.reportJobIssue(job.id, form)

      reset()
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send that. Try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const mapsHref =
    job.latitude != null && job.longitude != null
      ? `https://www.google.com/maps/search/?api=1&query=${job.latitude},${job.longitude}`
      : null

  return (
    <div
      className={`card overflow-hidden ${
        deadline.tone === 'overdue' ? 'border-l-4 border-l-red-500' : ''
      }`}
    >
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-2xl"
            aria-hidden
          >
            {job.category?.icon ?? '📋'}
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold leading-snug text-slate-900">{job.title}</h3>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
              <span className="font-mono text-slate-400">{job.referenceNo}</span>
              {job.sector && (
                <span className="font-medium text-slate-600">Sector {job.sector.number}</span>
              )}
              <span className={`rounded px-1.5 py-0.5 font-medium ${DEADLINE_TONE[deadline.tone]}`}>
                {deadline.text}
              </span>
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm leading-relaxed text-slate-700">{job.description}</p>

        {(job.landmark || job.address) && (
          <p className="mt-2 flex items-start gap-1.5 text-sm text-slate-600">
            <span aria-hidden>📍</span>
            {job.landmark ?? job.address}
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          {job.photoUrl && (
            <a
              href={job.photoUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-secondary btn-sm"
            >
              📷 See the reported problem
            </a>
          )}
          {mapsHref && (
            <a href={mapsHref} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
              🧭 Directions
            </a>
          )}
        </div>

        {job.supervisor && (
          <p className="mt-3 text-xs text-slate-500">
            Reporting to {job.supervisor.fullName}
            {job.supervisor.designationTitle && `, ${job.supervisor.designationTitle}`}
          </p>
        )}
      </div>

      {/* Actions get their own band so they are reachable with a thumb. */}
      {mode === 'none' ? (
        <div className="flex gap-2 border-t border-slate-100 bg-slate-50 p-3">
          <button onClick={() => setMode('complete')} className="btn-primary flex-1 py-3">
            ✅ Work finished
          </button>
          <button onClick={() => setMode('issue')} className="btn-secondary py-3">
            ⚠️ Problem
          </button>
        </div>
      ) : (
        <div className="space-y-3 border-t border-slate-100 bg-slate-50 p-4">
          {error && <ErrorBanner message={error} />}

          <p className="text-sm font-medium text-slate-800">
            {mode === 'complete' ? 'Report the work finished' : 'Report a problem'}
          </p>

          {mode === 'complete' && (
            <div>
              {preview ? (
                <div className="relative w-fit">
                  <img
                    src={preview}
                    alt="Photo of the finished work"
                    className="h-36 w-auto rounded-lg border border-slate-200 object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => choosePhoto(null)}
                    className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-slate-800 text-sm text-white"
                    aria-label="Remove photo"
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <label
                  htmlFor={`photo-${job.id}`}
                  className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-amber-300 bg-amber-50 px-4 py-6 text-center"
                >
                  <span className="text-3xl" aria-hidden>
                    📷
                  </span>
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

          <textarea
            rows={2}
            maxLength={2000}
            className="field resize-y"
            placeholder={
              mode === 'complete'
                ? 'What did you do? (optional)'
                : 'What is stopping the work? e.g. need a JCB, area locked, material not available'
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />

          <div className="flex gap-2">
            <button onClick={() => void submit()} className="btn-primary flex-1 py-3" disabled={submitting}>
              {submitting && <Spinner />}
              Send
            </button>
            <button onClick={reset} className="btn-secondary py-3">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function WorkerJobs({ scope = 'active' }: { scope?: 'active' | 'done' }) {
  const { user } = useAuth()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.jobs(scope)
      setJobs(res.items)
    } catch {
      setError('Could not load your jobs.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [scope])

  const posting = user?.primaryPosting
  const overdue = jobs.filter((j) => j.isOverdue).length

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={scope === 'done' ? 'Completed jobs' : 'My jobs'}
        description={
          posting
            ? `${posting.designationTitle ?? 'Field Worker'}${
                posting.sector ? ` · Sector ${posting.sector.number}` : ''
              }`
            : undefined
        }
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {scope === 'active' && !loading && jobs.length > 0 && (
        <div className="mb-5 flex gap-3">
          <div className="card flex-1 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Jobs today</p>
            <p className="tnum mt-1 text-2xl font-bold">{jobs.length}</p>
          </div>
          {overdue > 0 && (
            <div className="card flex-1 border-red-200 bg-red-50 px-4 py-3">
              <p className="text-xs font-medium uppercase tracking-wide text-red-600">Overdue</p>
              <p className="tnum mt-1 text-2xl font-bold text-red-700">{overdue}</p>
            </div>
          )}
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </div>
      ) : jobs.length === 0 ? (
        <EmptyState
          icon={scope === 'done' ? '📦' : '🎉'}
          title={scope === 'done' ? 'Nothing completed yet' : 'No jobs right now'}
          description={
            scope === 'done'
              ? 'Work you finish will be listed here.'
              : 'Your officer has not allotted any work to you. New jobs will appear here.'
          }
        />
      ) : (
        <div className="space-y-4">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} onChanged={() => void load()} />
          ))}
        </div>
      )}
    </div>
  )
}
