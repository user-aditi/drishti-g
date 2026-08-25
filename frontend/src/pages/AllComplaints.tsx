import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import ComplaintCard from '../components/ComplaintCard'
import { CardSkeleton, EmptyState, ErrorBanner, PageHeader } from '../components/ui'
import { STATUS_META } from '../lib/format'
import type { Complaint, ComplaintStatus, Sector } from '../lib/types'

const STATUS_FILTERS: (ComplaintStatus | '')[] = [
  '',
  'ROUTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'AWAITING_VERIFICATION',
  'RESOLVED',
  'CLOSED',
]

export default function AllComplaints() {
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [sectors, setSectors] = useState<Sector[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [status, setStatus] = useState<ComplaintStatus | ''>('')
  const [sectorId, setSectorId] = useState<number | ''>('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const SIZE = 20

  useEffect(() => {
    api.sectors().then(setSectors).catch(() => setSectors([]))
  }, [])

  // Debounce the search box so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search)
      setPage(1)
    }, 350)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    api
      .complaints({
        status: status || undefined,
        sectorId: sectorId === '' ? undefined : sectorId,
        q: query || undefined,
        page,
        size: SIZE,
      })
      .then((res) => {
        if (cancelled) return
        setComplaints(res.items)
        setTotal(res.total)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load complaints.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [status, sectorId, query, page])

  const pages = Math.max(1, Math.ceil(total / SIZE))

  return (
    <div>
      <PageHeader
        title="All complaints"
        description="Complaints across your jurisdiction, with the routing GCCE applied."
      />

      <div className="card-pad mb-5 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="search">
              Search
            </label>
            <input
              id="search"
              className="field"
              placeholder="Title, description or reference number"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="sector">
              Sector
            </label>
            <select
              id="sector"
              className="field"
              value={sectorId}
              onChange={(e) => {
                setSectorId(e.target.value === '' ? '' : Number(e.target.value))
                setPage(1)
              }}
            >
              <option value="">All sectors</option>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  Sector {s.number} — {s.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((s) => (
            <button
              key={s || 'all'}
              onClick={() => {
                setStatus(s)
                setPage(1)
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                status === s
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {s === '' ? 'All' : STATUS_META[s].label}
            </button>
          ))}
        </div>
      </div>

      {error && <ErrorBanner message={error} />}

      {loading ? (
        <div className="space-y-3">
          <CardSkeleton rows={2} />
          <CardSkeleton rows={2} />
          <CardSkeleton rows={2} />
        </div>
      ) : complaints.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No complaints match"
          description="Try clearing the filters or searching for something else."
        />
      ) : (
        <>
          <div className="space-y-3">
            {complaints.map((c) => (
              <ComplaintCard key={c.id} complaint={c} to={`/complaints/${c.id}`} showDeadline />
            ))}
          </div>

          <div className="mt-5 flex items-center justify-between">
            <p className="tnum text-sm text-slate-500">
              {total} complaint{total === 1 ? '' : 's'} · page {page} of {pages}
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
