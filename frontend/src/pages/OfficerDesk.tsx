import { useEffect, useState } from 'react'
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
import { DEADLINE_TONE, TRADE_LABEL, deadlineLabel, relativeTime } from '../lib/format'
import type { CrewMember, DeskItem } from '../lib/types'

/**
 * Allotment: the step a naive complaint app skips.
 *
 * The Junior Engineer decides *who* does the work, from their own sector crew.
 * Without this, a worker would be handed complaints they have no authority to
 * triage — and the inspection step afterwards would have no meaning.
 */
function AllotPanel({ task, onDone }: { task: DeskItem; onDone: () => void }) {
  const [crew, setCrew] = useState<CrewMember[]>([])
  const [preferredTrade, setPreferredTrade] = useState<string | null>(null)
  const [exactTrade, setExactTrade] = useState(true)
  const [selected, setSelected] = useState<number | null>(null)
  const [instructions, setInstructions] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api
      .crewFor(task.id)
      .then((res) => {
        setCrew(res.items)
        setPreferredTrade(res.preferredTrade)
        setExactTrade(res.exactTradeAvailable)
        // Pre-select the least-loaded member, which is what an officer picks by
        // default anyway.
        setSelected(res.items[0]?.userId ?? null)
      })
      .catch(() => setError('Could not load your sector crew.'))
      .finally(() => setLoading(false))
  }, [task.id])

  async function allot() {
    if (selected == null) return
    setSubmitting(true)
    setError(null)
    try {
      await api.allotJob(task.id, selected, instructions || undefined)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not allot this job.')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return <div className="mt-3"><CardSkeleton rows={2} /></div>

  return (
    <div className="mt-4 space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      {error && <ErrorBanner message={error} />}

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <p className="label mb-0">Allot to a member of your crew</p>
          {preferredTrade && (
            <span className="text-xs text-slate-500">
              {exactTrade ? (
                <>
                  Trade required:{' '}
                  <span className="font-medium text-slate-700">
                    {TRADE_LABEL[preferredTrade as keyof typeof TRADE_LABEL]}
                  </span>
                </>
              ) : (
                <span className="text-amber-700">
                  No {TRADE_LABEL[preferredTrade as keyof typeof TRADE_LABEL]} posted here —
                  showing the whole crew
                </span>
              )}
            </span>
          )}
        </div>

        {crew.length === 0 ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            No field workers are posted to this sector for your department. Ask the administrator to
            post a crew before this can be actioned.
          </p>
        ) : (
          <div className="space-y-1.5">
            {crew.map((w) => (
              <button
                key={w.userId}
                type="button"
                onClick={() => setSelected(w.userId)}
                aria-pressed={selected === w.userId}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-all ${
                  selected === w.userId
                    ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-slate-900">{w.fullName}</span>
                  <span className="block text-xs text-slate-500">
                    {w.designationTitle}
                    {w.employeeCode && ` · ${w.employeeCode}`}
                  </span>
                </span>
                <span
                  className={`tnum shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                    w.activeJobs === 0
                      ? 'bg-emerald-100 text-emerald-700'
                      : w.activeJobs > 3
                        ? 'bg-amber-100 text-amber-700'
                        : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {w.activeJobs} active
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {crew.length > 0 && (
        <>
          <div>
            <label className="label" htmlFor={`instr-${task.id}`}>
              Instructions for the crew{' '}
              <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <textarea
              id={`instr-${task.id}`}
              rows={2}
              maxLength={2000}
              className="field resize-y"
              placeholder="e.g. Take the jetting machine. Clear the full stretch, not just the mouth."
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <button onClick={() => void allot()} className="btn-primary" disabled={submitting}>
            {submitting && <Spinner />}
            Allot job
          </button>
        </>
      )}
    </div>
  )
}

/** Inspection: accept the reported work, or send it back to the crew. */
function InspectPanel({ task, onDone }: { task: DeskItem; onDone: () => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<'accept' | 'reject' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function decide(accept: boolean) {
    if (!accept && !note.trim()) {
      return setError('Say what is wrong before sending it back to the crew.')
    }
    setBusy(accept ? 'accept' : 'reject')
    setError(null)
    try {
      await api.verifyWork(task.id, accept, note || undefined)
      onDone()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record your decision.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-violet-200 bg-violet-50/60 p-4">
      {error && <ErrorBanner message={error} />}

      <p className="text-sm text-slate-700">
        {task.assignedWorker?.fullName ?? 'The crew'} has reported this complete. Inspect the work
        before it counts as resolved.
      </p>

      <div>
        <label className="label" htmlFor={`insp-${task.id}`}>
          Inspection note
        </label>
        <textarea
          id={`insp-${task.id}`}
          rows={2}
          maxLength={2000}
          className="field resize-y"
          placeholder="What did you find on site?"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button onClick={() => void decide(true)} className="btn-primary" disabled={busy !== null}>
          {busy === 'accept' && <Spinner />}
          Accept the work
        </button>
        <button onClick={() => void decide(false)} className="btn-secondary" disabled={busy !== null}>
          {busy === 'reject' && <Spinner />}
          Send back to crew
        </button>
        <Link to={`/complaints/${task.id}`} className="btn-ghost">
          See the evidence photo
        </Link>
      </div>
    </div>
  )
}

function DeskRow({ task, onChanged }: { task: DeskItem; onChanged: () => void }) {
  const [panel, setPanel] = useState<'none' | 'allot' | 'inspect'>('none')
  const deadline = deadlineLabel(task.slaDueAt, true)

  const border = task.escalationLevel > 0
    ? 'border-l-4 border-l-purple-500'
    : deadline.tone === 'overdue'
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
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {task.escalationLevel > 0 && (
                <span className="pill bg-purple-100 text-purple-800">
                  ⬆️ Escalated ×{task.escalationLevel}
                </span>
              )}
              <StatusPill status={task.status} />
              {task.priority !== 'MEDIUM' && <PriorityPill priority={task.priority} />}
            </div>
          </div>

          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-600">
            {task.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
            <span className="font-mono text-[11px] text-slate-400">{task.referenceNo}</span>
            {task.sector && <span>Sector {task.sector.number}</span>}
            <span>filed {relativeTime(task.createdAt)}</span>
            <span className={`rounded px-1.5 py-0.5 font-medium ${DEADLINE_TONE[deadline.tone]}`}>
              {deadline.text}
            </span>
            {task.assignedWorker && (
              <span className="text-slate-600">crew: {task.assignedWorker.fullName}</span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {task.needsAllotment && (
              <button
                onClick={() => setPanel(panel === 'allot' ? 'none' : 'allot')}
                className="btn-primary btn-sm"
                aria-expanded={panel === 'allot'}
              >
                {panel === 'allot' ? 'Close' : 'Allot to crew'}
              </button>
            )}
            {task.status === 'AWAITING_VERIFICATION' && (
              <button
                onClick={() => setPanel(panel === 'inspect' ? 'none' : 'inspect')}
                className="btn-primary btn-sm"
                aria-expanded={panel === 'inspect'}
              >
                {panel === 'inspect' ? 'Close' : 'Inspect work'}
              </button>
            )}
            <Link to={`/complaints/${task.id}`} className="btn-secondary btn-sm">
              Open case file
            </Link>
          </div>

          {panel === 'allot' && (
            <AllotPanel
              task={task}
              onDone={() => {
                setPanel('none')
                onChanged()
              }}
            />
          )}
          {panel === 'inspect' && (
            <InspectPanel
              task={task}
              onDone={() => {
                setPanel('none')
                onChanged()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export default function OfficerDesk({ scope = 'active' }: { scope?: 'active' | 'awaiting' | 'done' }) {
  const { user } = useAuth()
  const [items, setItems] = useState<DeskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.desk(scope)
      setItems(res.items)
    } catch {
      setError('Could not load your desk.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [scope])

  const posting = user?.primaryPosting
  const needsAllotment = items.filter((i) => i.needsAllotment).length
  const overdue = items.filter((i) => i.isOverdue).length
  const escalated = items.filter((i) => i.escalationLevel > 0).length

  const title =
    scope === 'awaiting' ? 'Work to inspect' : scope === 'done' ? 'Completed' : 'My desk'

  return (
    <div>
      <PageHeader
        title={title}
        description={
          posting
            ? `${posting.designationTitle ?? 'Section Officer'}${
                posting.sector ? ` · Sector ${posting.sector.number}` : ''
              }${posting.department ? ` · ${posting.department.name}` : ''}`
            : undefined
        }
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      {scope === 'active' && !loading && items.length > 0 && (
        <div className="mb-6 grid gap-3 sm:grid-cols-4">
          <StatTile label="Open cases" value={items.length} icon={<span className="text-2xl">🗂️</span>} />
          <StatTile
            label="Need a crew"
            value={needsAllotment}
            tone={needsAllotment > 0 ? 'warning' : 'default'}
            hint="Assigned to you, nobody on the job"
          />
          <StatTile
            label="Overdue"
            value={overdue}
            tone={overdue > 0 ? 'danger' : 'success'}
            hint={overdue > 0 ? 'Escalating up the chain' : 'Nothing past deadline'}
          />
          <StatTile
            label="Escalated"
            value={escalated}
            tone={escalated > 0 ? 'danger' : 'default'}
            hint="Already raised above you"
          />
        </div>
      )}

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={scope === 'done' ? '📦' : '🎉'}
          title={
            scope === 'awaiting'
              ? 'Nothing waiting on inspection'
              : scope === 'done'
                ? 'Nothing completed yet'
                : 'Desk clear'
          }
          description={
            scope === 'awaiting'
              ? 'When a crew reports a job complete, it will appear here for you to inspect.'
              : scope === 'done'
                ? 'Work you accept will be listed here.'
                : 'No complaints are currently assigned to you. GCCE routes new ones here automatically.'
          }
        />
      ) : (
        <div className="space-y-3">
          {items.map((task) => (
            <DeskRow key={task.id} task={task} onChanged={() => void load()} />
          ))}
        </div>
      )}
    </div>
  )
}
