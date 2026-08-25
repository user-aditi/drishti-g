import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import {
  CardSkeleton,
  EmptyState,
  ErrorBanner,
  PageHeader,
  PriorityPill,
  Spinner,
  StatTile,
  StatusPill,
} from '../components/ui'
import { STATUS_META, deadlineLabel, relativeTime } from '../lib/format'
import type { ComplaintStatus, Task } from '../lib/types'

/** What an official is actually doing when they pick each next status. */
const ACTION_LABEL: Partial<Record<ComplaintStatus, string>> = {
  IN_PROGRESS: 'Start work',
  RESOLVED: 'Mark resolved',
  REJECTED: 'Reject',
  DUPLICATE: 'Mark duplicate',
}

function UpdateForm({
  task,
  onDone,
  onCancel,
}: {
  task: Task
  onDone: () => void
  onCancel: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [toStatus, setToStatus] = useState<ComplaintStatus>(task.nextStatuses[0] ?? 'IN_PROGRESS')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Resolving is the claim that the work is done, so the API insists on a photo.
  // Surfacing that here avoids a round trip to be told so.
  const evidenceRequired = toStatus === 'RESOLVED'

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
    if (evidenceRequired && !photo) {
      return setError('Attach a photo of the completed work before marking this resolved.')
    }
    setSubmitting(true)
    setError(null)
    try {
      const form = new FormData()
      form.append('toStatus', toStatus)
      if (note) form.append('note', note)
      if (photo) form.append('photo', photo)
      await api.updateTaskStatus(task.id, form)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this task.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {error && <ErrorBanner message={error} />}

      <div>
        <p className="label">What is the update?</p>
        <div className="flex flex-wrap gap-2">
          {task.nextStatuses.map((status) => (
            <button
              key={status}
              type="button"
              onClick={() => setToStatus(status)}
              aria-pressed={toStatus === status}
              className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition-all ${
                toStatus === status
                  ? 'border-brand-500 bg-brand-600 text-white'
                  : 'border-slate-300 bg-white text-slate-700 hover:border-slate-400'
              }`}
            >
              {ACTION_LABEL[status] ?? STATUS_META[status].label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="label" htmlFor={`note-${task.id}`}>
          Notes {evidenceRequired && <span className="font-normal text-slate-400">(optional)</span>}
        </label>
        <textarea
          id={`note-${task.id}`}
          rows={2}
          maxLength={2000}
          className="field resize-y"
          placeholder="What did you find on site? What was done?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div>
        <label className="label" htmlFor={`photo-${task.id}`}>
          Evidence photo{' '}
          {evidenceRequired ? (
            <span className="font-normal text-red-500">(required)</span>
          ) : (
            <span className="font-normal text-slate-400">(optional)</span>
          )}
        </label>

        {preview ? (
          <div className="relative w-fit">
            <img
              src={preview}
              alt="Evidence to be submitted"
              className="h-28 w-auto rounded-lg border border-slate-200 object-cover"
            />
            <button
              type="button"
              onClick={() => {
                choosePhoto(null)
                if (fileRef.current) fileRef.current.value = ''
              }}
              className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-slate-800 text-xs text-white"
              aria-label="Remove photo"
            >
              ✕
            </button>
          </div>
        ) : (
          <label
            htmlFor={`photo-${task.id}`}
            className={`flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-5 text-sm transition-colors ${
              evidenceRequired
                ? 'border-amber-300 bg-amber-50 text-amber-800 hover:border-amber-400'
                : 'border-slate-300 bg-white text-slate-600 hover:border-brand-400'
            }`}
          >
            <span aria-hidden>📷</span>
            {evidenceRequired ? 'Photo of the completed work' : 'Add a photo'}
          </label>
        )}

        <input
          ref={fileRef}
          id={`photo-${task.id}`}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/heic"
          className="sr-only"
          onChange={(e) => choosePhoto(e.target.files?.[0] ?? null)}
        />
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting && <Spinner />}
          Submit update
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  )
}

function TaskRow({ task, onUpdated }: { task: Task; onUpdated: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const deadline = deadlineLabel(task.slaDueAt, true)

  const border =
    deadline.tone === 'overdue'
      ? 'border-l-4 border-l-red-500'
      : deadline.tone === 'urgent'
        ? 'border-l-4 border-l-amber-500'
        : ''

  return (
    <div className={`card p-4 ${border}`}>
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg"
          aria-hidden
        >
          {task.category?.icon ?? '📋'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 font-medium text-slate-900">{task.title}</h3>
            <div className="flex shrink-0 gap-1.5">
              <StatusPill status={task.status} />
              {task.priority !== 'MEDIUM' && <PriorityPill priority={task.priority} />}
            </div>
          </div>

          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-600">
            {task.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
            <span className="font-mono text-[11px] text-slate-400">{task.referenceNo}</span>
            {task.ward && <span>Ward {task.ward.wardNumber} · {task.ward.name}</span>}
            <span>filed {relativeTime(task.createdAt)}</span>
            <span
              className={`rounded px-1.5 py-0.5 font-medium ${
                deadline.tone === 'overdue'
                  ? 'bg-red-100 text-red-700'
                  : deadline.tone === 'urgent'
                    ? 'bg-amber-100 text-amber-700'
                    : 'bg-slate-100 text-slate-600'
              }`}
            >
              {deadline.text}
            </span>
          </div>

          {task.address && (
            <p className="mt-2 text-xs text-slate-500">
              <span aria-hidden>📍</span> {task.address}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {task.nextStatuses.length > 0 && (
              <button
                onClick={() => setExpanded((v) => !v)}
                className="btn-secondary btn-sm"
                aria-expanded={expanded}
              >
                {expanded ? 'Close' : 'Update status'}
              </button>
            )}
            <Link to={`/complaints/${task.id}`} className="btn-ghost btn-sm">
              View full history
            </Link>
            {task.photoUrl && (
              <a href={task.photoUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-sm">
                📷 Citizen photo
              </a>
            )}
          </div>

          {expanded && (
            <UpdateForm
              task={task}
              onCancel={() => setExpanded(false)}
              onDone={() => {
                setExpanded(false)
                onUpdated()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function TaskInbox({ scope = 'active' }: { scope?: 'active' | 'done' }) {
  const { user } = useAuth()
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.tasks(scope)
      setTasks(res.items)
    } catch {
      setError('Could not load your tasks.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [scope])

  const overdue = tasks.filter((t) => t.isOverdue).length
  const dueSoon = tasks.filter(
    (t) => !t.isOverdue && t.hoursRemaining != null && t.hoursRemaining < 12,
  ).length

  return (
    <div>
      <PageHeader
        title={scope === 'done' ? 'Completed work' : 'Task inbox'}
        description={
          scope === 'done'
            ? 'Everything you have resolved or closed.'
            : `Assigned to you${user?.department ? ` · ${user.department.name}` : ''}${
                user?.ward ? ` · Ward ${user.ward.wardNumber}` : ''
              }`
        }
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {scope === 'active' && !loading && tasks.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-3">
          <StatTile label="Open tasks" value={tasks.length} icon={<span className="text-2xl">🧰</span>} />
          <StatTile
            label="Overdue"
            value={overdue}
            tone={overdue > 0 ? 'danger' : 'default'}
            hint={overdue > 0 ? 'Past the resolution deadline' : 'Nothing past deadline'}
          />
          <StatTile
            label="Due within 12h"
            value={dueSoon}
            tone={dueSoon > 0 ? 'warning' : 'default'}
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={scope === 'done' ? '📦' : '🎉'}
          title={scope === 'done' ? 'Nothing completed yet' : 'Inbox zero'}
          description={
            scope === 'done'
              ? 'Work you resolve will be listed here.'
              : 'No complaints are currently assigned to you. GCCE will route new ones here automatically.'
          }
        />
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} onUpdated={() => void load()} />
          ))}
        </div>
      )}
    </div>
  )
}
