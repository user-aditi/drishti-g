import { useEffect, useState } from 'react'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { CardSkeleton, ErrorBanner, PageHeader, SectionHeading, Spinner } from '../components/ui'
import { isAuthorityWide } from '../lib/format'
import type { Department } from '../lib/types'

/**
 * The department registry.
 *
 * Coming-soon departments are shown rather than hidden: a citizen looking for
 * water supply deserves to know the department exists and is not live yet,
 * instead of concluding the authority has no such wing and giving up.
 */
export default function Departments() {
  const { user } = useAuth()
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const canManage = user != null && isAuthorityWide(user.rank)

  async function load() {
    setLoading(true)
    try {
      setDepartments(await api.departments())
    } catch {
      setError('Could not load departments.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function toggleStatus(dept: Department) {
    setBusyId(dept.id)
    setError(null)
    try {
      await api.updateDepartment(dept.id, {
        status: dept.status === 'ACTIVE' ? 'COMING_SOON' : 'ACTIVE',
      })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update that department.')
    } finally {
      setBusyId(null)
    }
  }

  if (loading) return <CardSkeleton rows={6} />

  const live = departments.filter((d) => d.status === 'ACTIVE')
  const planned = departments.filter((d) => d.status === 'COMING_SOON')

  return (
    <div>
      <PageHeader
        title="Departments"
        description="NOIDA Authority wings and what each one handles."
      />

      {error && <ErrorBanner message={error} />}

      <SectionHeading
        title="Live now"
        description="Accepting complaints, staffed down to sector level."
      />
      <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {live.map((d) => (
          <div key={d.id} className="card-pad">
            <div className="flex items-start gap-3">
              <span className="text-2xl" aria-hidden>
                {d.icon}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold leading-tight text-slate-900">{d.name}</h3>
                {d.nameHi && <p className="text-sm text-slate-500">{d.nameHi}</p>}
              </div>
              <span className="pill shrink-0 bg-emerald-100 text-emerald-800">Live</span>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-slate-600">{d.description}</p>

            {d._count && (
              <dl className="tnum mt-4 grid grid-cols-3 gap-2 border-t border-slate-100 pt-3 text-center">
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">Categories</dt>
                  <dd className="text-sm font-semibold text-slate-800">{d._count.categories}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">Staff</dt>
                  <dd className="text-sm font-semibold text-slate-800">{d._count.postings}</dd>
                </div>
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-slate-400">Complaints</dt>
                  <dd className="text-sm font-semibold text-slate-800">{d._count.complaints}</dd>
                </div>
              </dl>
            )}

            {canManage && (
              <button
                onClick={() => void toggleStatus(d)}
                className="btn-secondary btn-sm mt-3 w-full"
                disabled={busyId === d.id}
              >
                {busyId === d.id && <Spinner className="h-3 w-3" />}
                Take offline
              </button>
            )}
          </div>
        ))}
      </div>

      <SectionHeading
        title="On the roadmap"
        description="Listed so nobody has to guess whether the authority handles it."
      />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {planned.map((d) => (
          <div key={d.id} className="card-pad border-dashed bg-slate-50/60">
            <div className="flex items-start gap-3">
              <span className="text-2xl opacity-50" aria-hidden>
                {d.icon}
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold leading-tight text-slate-700">{d.name}</h3>
                {d.nameHi && <p className="text-sm text-slate-400">{d.nameHi}</p>}
              </div>
              <span className="pill shrink-0 bg-slate-200 text-slate-600">Coming soon</span>
            </div>

            <p className="mt-3 text-sm leading-relaxed text-slate-500">{d.description}</p>

            {d.roadmapNote && (
              <p className="mt-3 rounded-lg bg-white px-3 py-2 text-xs leading-relaxed text-slate-500">
                {d.roadmapNote}
              </p>
            )}

            {canManage && (
              <button
                onClick={() => void toggleStatus(d)}
                className="btn-primary btn-sm mt-3 w-full"
                disabled={busyId === d.id}
              >
                {busyId === d.id && <Spinner className="h-3 w-3" />}
                Make live
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
