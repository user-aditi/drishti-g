import { useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { RiskExplanation, RiskWorking } from '../components/RiskExplanation'
import {
  CardSkeleton,
  EmptyState,
  ErrorBanner,
  PageHeader,
  RiskDial,
  SectionHeading,
  Spinner,
} from '../components/ui'
import { formatDateTime, relativeTime } from '../lib/format'
import type { ReviewStatus, RiskDetail, RiskFlag } from '../lib/types'

const ENTITY_ICON: Record<string, string> = {
  WARD: '🏘️',
  CONTRACTOR: '🏗️',
  PROJECT: '📐',
}

const REVIEW_ACTIONS: { status: ReviewStatus; label: string; hint: string; className: string }[] = [
  {
    status: 'ACKNOWLEDGED',
    label: 'Acknowledge',
    hint: 'Seen, monitoring it',
    className: 'btn-secondary',
  },
  {
    status: 'ACTIONED',
    label: 'Action taken',
    hint: 'Something was done about it',
    className: 'btn-primary',
  },
  {
    status: 'DISMISSED',
    label: 'Dismiss',
    hint: 'Not a real concern',
    className: 'btn-secondary',
  },
]

function FlagCard({ flag, onReviewed }: { flag: RiskFlag; onReviewed: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [detail, setDetail] = useState<RiskDetail | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState<ReviewStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  // The full working is only fetched when someone actually opens the card —
  // the queue itself already carries enough to triage.
  useEffect(() => {
    if (!expanded || detail) return
    api
      .riskDetail(flag.entityType, flag.entityId)
      .then(setDetail)
      .catch(() => setDetail(null))
  }, [expanded, detail, flag.entityType, flag.entityId])

  async function review(status: ReviewStatus) {
    setBusy(status)
    setError(null)
    try {
      await api.reviewFlag(flag.id, status, note || undefined)
      onReviewed()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not record your decision.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-start gap-4 p-5">
        <RiskDial score={flag.score} band={flag.band} size={88} />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-lg" aria-hidden>
              {ENTITY_ICON[flag.entityType] ?? '📍'}
            </span>
            <h3 className="truncate font-semibold text-slate-900">{flag.entityLabel}</h3>
          </div>

          <p className="mt-1.5 text-sm leading-relaxed text-slate-700">{flag.reason}</p>

          <p className="mt-2 text-xs text-slate-400">
            Flagged {relativeTime(flag.createdAt)}
            {flag.updatedAt !== flag.createdAt && ` · updated ${relativeTime(flag.updatedAt)}`}
          </p>

          <button
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="mt-3 text-sm font-medium text-brand-600 hover:underline"
          >
            {expanded ? 'Hide the reasoning' : 'Why was this flagged?'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="animate-fade-up space-y-5 border-t border-slate-100 bg-slate-50/60 p-5">
          <div>
            <SectionHeading title="Contributing factors" />
            <RiskExplanation factors={flag.factors} score={flag.score} band={flag.band} compact />
          </div>

          {detail && (
            <div>
              <SectionHeading
                title="The arithmetic"
                description="Every number that produced this score, so you can check it yourself."
              />
              <RiskWorking factors={detail.factors} score={detail.score} />
              <p className="mt-3 text-xs text-slate-500">
                Model <span className="font-mono">{detail.modelVersion}</span> · computed{' '}
                {formatDateTime(detail.computedAt)}
              </p>
            </div>
          )}

          <div className="border-t border-slate-200 pt-4">
            <SectionHeading
              title="Your decision"
              description="Recorded in the audit trail against your name."
            />

            {error && <ErrorBanner message={error} />}

            <textarea
              rows={2}
              maxLength={2000}
              className="field mb-3 resize-y"
              placeholder="Optional note — what did you find, what did you do?"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />

            <div className="flex flex-wrap gap-2">
              {REVIEW_ACTIONS.map((action) => (
                <button
                  key={action.status}
                  onClick={() => void review(action.status)}
                  disabled={busy !== null}
                  title={action.hint}
                  className={`${action.className} btn-sm`}
                >
                  {busy === action.status && <Spinner className="h-3 w-3" />}
                  {action.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RiskQueue() {
  const [flags, setFlags] = useState<RiskFlag[]>([])
  const [threshold, setThreshold] = useState(60)
  const [status, setStatus] = useState<ReviewStatus>('PENDING')
  const [loading, setLoading] = useState(true)
  const [recomputing, setRecomputing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.riskQueue(status)
      setFlags(res.items)
      setThreshold(res.threshold)
    } catch {
      setError('Could not load the risk queue.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [status])

  async function recompute() {
    setRecomputing(true)
    try {
      await api.recomputeRisk()
      await load()
    } catch {
      setError('Could not recompute scores.')
    } finally {
      setRecomputing(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Risk review queue"
        description={`GRIE flags anything scoring ${threshold} or above. Every score shows its own reasoning.`}
        action={
          <button onClick={() => void recompute()} className="btn-secondary" disabled={recomputing}>
            {recomputing && <Spinner />}
            {recomputing ? 'Recomputing…' : 'Recompute scores'}
          </button>
        }
      />

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <div className="mb-5 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['PENDING', 'Needs review'],
            ['ACKNOWLEDGED', 'Acknowledged'],
            ['ACTIONED', 'Actioned'],
            ['DISMISSED', 'Dismissed'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setStatus(key)}
            className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              status === key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-4">
          <CardSkeleton rows={3} />
          <CardSkeleton rows={3} />
        </div>
      ) : flags.length === 0 ? (
        <EmptyState
          icon={status === 'PENDING' ? '✅' : '📭'}
          title={status === 'PENDING' ? 'Nothing needs review' : 'Nothing here'}
          description={
            status === 'PENDING'
              ? `No ward, contractor or project is currently scoring ${threshold} or above.`
              : 'No flags have reached this state yet.'
          }
        />
      ) : (
        <div className="space-y-4">
          {flags.map((flag) => (
            <FlagCard key={flag.id} flag={flag} onReviewed={() => void load()} />
          ))}
        </div>
      )}
    </div>
  )
}
