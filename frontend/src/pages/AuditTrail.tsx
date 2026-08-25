import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { CardSkeleton, EmptyState, ErrorBanner, PageHeader, Spinner } from '../components/ui'
import { formatDateTime, humaniseAction, relativeTime } from '../lib/format'
import type { AuditEvent, ChainResult } from '../lib/types'

/** Which engine wrote the entry. */
const SOURCE_META: Record<string, { label: string; className: string }> = {
  gcce: { label: 'GCCE', className: 'bg-brand-100 text-brand-800' },
  grie: { label: 'GRIE', className: 'bg-purple-100 text-purple-800' },
  api: { label: 'User', className: 'bg-slate-100 text-slate-700' },
  system: { label: 'System', className: 'bg-slate-100 text-slate-500' },
}

function ChainStatus({ result, onVerify, verifying }: {
  result: ChainResult | null
  onVerify: () => void
  verifying: boolean
}) {
  return (
    <div
      className={`card flex flex-wrap items-center justify-between gap-4 p-5 ${
        result && !result.valid ? 'border-red-300 bg-red-50' : ''
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl" aria-hidden>
          {result == null ? '🔒' : result.valid ? '✅' : '🚨'}
        </span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900">
            {result == null
              ? 'Tamper-evident audit trail'
              : result.valid
                ? 'Chain intact'
                : 'Chain broken'}
          </h2>
          <p className="mt-0.5 max-w-xl text-xs leading-relaxed text-slate-600">
            {result == null ? (
              <>
                Each entry stores a fingerprint of the entry before it, so editing or deleting any
                historical record breaks every fingerprint after it.
              </>
            ) : result.valid ? (
              <>
                All {result.checked} entries verified. No record has been edited or removed since it
                was written.
              </>
            ) : (
              <span className="text-red-700">
                {result.reason} — first detected at entry #{result.brokenAtId}.
              </span>
            )}
          </p>
          {result?.valid && result.head && (
            <p className="mt-1.5 font-mono text-[10px] text-slate-400">
              head {result.head.slice(0, 32)}…
            </p>
          )}
        </div>
      </div>

      <button onClick={onVerify} className="btn-secondary btn-sm" disabled={verifying}>
        {verifying && <Spinner className="h-3 w-3" />}
        {verifying ? 'Verifying…' : 'Verify chain'}
      </button>
    </div>
  )
}

function EventRow({ event }: { event: AuditEvent }) {
  const [open, setOpen] = useState(false)
  const source = SOURCE_META[event.source] ?? SOURCE_META.api!

  return (
    <li className="px-4 py-3 transition-colors hover:bg-slate-50">
      <div className="flex items-start gap-3">
        <span className={`pill shrink-0 ${source.className}`}>{source.label}</span>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-slate-900">
              {humaniseAction(event.action)}
              <span className="ml-1.5 font-normal text-slate-500">
                {event.entityType} #{event.entityId}
              </span>
            </span>
            <time className="text-xs text-slate-400" title={formatDateTime(event.createdAt)}>
              {relativeTime(event.createdAt)}
            </time>
          </div>

          <p className="mt-0.5 text-xs text-slate-500">
            {event.actorLabel ?? 'Automated'}
          </p>

          <button
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="mt-1.5 text-xs font-medium text-brand-600 hover:underline"
          >
            {open ? 'Hide record' : 'Show record'}
          </button>

          {open && (
            <div className="animate-fade-up mt-2 space-y-2">
              <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">
                {JSON.stringify(event.payload, null, 2)}
              </pre>
              <dl className="grid gap-1 font-mono text-[10px] text-slate-400">
                <div className="flex gap-2">
                  <dt className="shrink-0">hash</dt>
                  <dd className="truncate">{event.hash}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0">prev</dt>
                  <dd className="truncate">{event.prevHash ?? '—'}</dd>
                </div>
              </dl>
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

export default function AuditTrail() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [filter, setFilter] = useState('')
  const [chain, setChain] = useState<ChainResult | null>(null)
  const [verifying, setVerifying] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const SIZE = 25

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.auditTrail({ action: filter || undefined, page, size: SIZE })
      setEvents(res.items)
      setTotal(res.total)
    } catch {
      setError('Could not load the audit trail.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [page, filter])

  async function verify() {
    setVerifying(true)
    try {
      setChain(await api.verifyChain())
    } catch {
      setError('Could not verify the chain.')
    } finally {
      setVerifying(false)
    }
  }

  const pages = Math.max(1, Math.ceil(total / SIZE))

  return (
    <div>
      <PageHeader
        title="Audit trail"
        description="Every action the system took, in order, with a fingerprint linking each to the last."
      />

      <div className="mb-5">
        <ChainStatus result={chain} onVerify={() => void verify()} verifying={verifying} />
      </div>

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['', 'Everything'],
            ['complaint', 'Complaints'],
            ['risk', 'Risk'],
            ['user', 'Accounts'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => {
              setFilter(key)
              setPage(1)
            }}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <CardSkeleton rows={8} />
      ) : events.length === 0 ? (
        <EmptyState icon="🔍" title="No matching entries" />
      ) : (
        <>
          <div className="card overflow-hidden">
            <ul className="divide-y divide-slate-100">
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </ul>
          </div>

          <div className="mt-4 flex items-center justify-between">
            <p className="tnum text-sm text-slate-500">
              {total} entries · page {page} of {pages}
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1}
                className="btn-secondary btn-sm"
              >
                Previous
              </button>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="btn-secondary btn-sm"
              >
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
