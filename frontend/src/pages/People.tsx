import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { CardSkeleton, ErrorBanner, PageHeader, SectionHeading, Spinner } from '../components/ui'
import { RANK_LABEL, RANK_LEVEL, RANK_STYLE, TRADE_LABEL, initials } from '../lib/format'
import type { Department, GeographyTree, Rank, Trade, User } from '../lib/types'

/** Ranks the Super Admin can appoint, from the top down. */
const APPOINTABLE: Rank[] = [
  'HOD',
  'ZONAL_OFFICER',
  'CIRCLE_OFFICER',
  'SECTION_OFFICER',
  'FIELD_WORKER',
]

/** What geography each rank must be posted to. */
const NEEDS: Record<string, 'zone' | 'circle' | 'sector' | 'none'> = {
  HOD: 'none',
  ZONAL_OFFICER: 'zone',
  CIRCLE_OFFICER: 'circle',
  SECTION_OFFICER: 'sector',
  FIELD_WORKER: 'sector',
}

function AppointForm({
  departments,
  geography,
  onCreated,
  onCancel,
}: {
  departments: Department[]
  geography: GeographyTree[]
  onCreated: () => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    rank: 'SECTION_OFFICER' as Rank,
    departmentId: '',
    zoneId: '',
    circleId: '',
    sectorId: '',
    trade: '' as Trade | '',
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const update = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const needs = NEEDS[form.rank] ?? 'none'

  const circles = geography.flatMap((z) => z.circles)
  const sectors = circles.flatMap((c) => c.sectors)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await api.createStaff({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        rank: form.rank,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
        zoneId: needs === 'zone' && form.zoneId ? Number(form.zoneId) : null,
        circleId: needs === 'circle' && form.circleId ? Number(form.circleId) : null,
        sectorId: needs === 'sector' && form.sectorId ? Number(form.sectorId) : null,
        trade: form.rank === 'FIELD_WORKER' && form.trade ? form.trade : null,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create this posting.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="card-pad mb-5 space-y-4">
      <SectionHeading
        title="Appoint someone to a post"
        description="A person and their posting are created together — someone without a posting is not on the org chart and receives no work."
      />

      {error && <ErrorBanner message={error} />}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="fullName">
            Full name
          </label>
          <input
            id="fullName"
            required
            minLength={2}
            className="field"
            value={form.fullName}
            onChange={(e) => update('fullName', e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="email">
            Official email
          </label>
          <input
            id="email"
            type="email"
            required
            className="field"
            placeholder="name@noidaauthority.in"
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="password">
            Temporary password
          </label>
          <input
            id="password"
            type="text"
            required
            minLength={8}
            className="field"
            placeholder="At least 8 characters"
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="rank">
            Post
          </label>
          <select
            id="rank"
            className="field"
            value={form.rank}
            onChange={(e) => update('rank', e.target.value)}
          >
            {APPOINTABLE.map((r) => (
              <option key={r} value={r}>
                {RANK_LABEL[r]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="label" htmlFor="departmentId">
            Department
          </label>
          <select
            id="departmentId"
            required
            className="field"
            value={form.departmentId}
            onChange={(e) => update('departmentId', e.target.value)}
          >
            <option value="">Select a department</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.icon} {d.name}
                {d.status === 'COMING_SOON' ? ' (not live yet)' : ''}
              </option>
            ))}
          </select>
        </div>

        {needs === 'zone' && (
          <div>
            <label className="label" htmlFor="zoneId">
              Zone
            </label>
            <select
              id="zoneId"
              required
              className="field"
              value={form.zoneId}
              onChange={(e) => update('zoneId', e.target.value)}
            >
              <option value="">Select a zone</option>
              {geography.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {needs === 'circle' && (
          <div>
            <label className="label" htmlFor="circleId">
              Work circle
            </label>
            <select
              id="circleId"
              required
              className="field"
              value={form.circleId}
              onChange={(e) => update('circleId', e.target.value)}
            >
              <option value="">Select a circle</option>
              {geography.map((z) => (
                <optgroup key={z.id} label={z.name}>
                  {z.circles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        )}

        {needs === 'sector' && (
          <div>
            <label className="label" htmlFor="sectorId">
              Sector
            </label>
            <select
              id="sectorId"
              required
              className="field"
              value={form.sectorId}
              onChange={(e) => update('sectorId', e.target.value)}
            >
              <option value="">Select a sector</option>
              {geography.map((z) =>
                z.circles.map((c) => (
                  <optgroup key={c.id} label={`${z.name} · ${c.name}`}>
                    {c.sectors.map((s) => (
                      <option key={s.id} value={s.id}>
                        Sector {s.number} — {s.name}
                      </option>
                    ))}
                  </optgroup>
                )),
              )}
            </select>
          </div>
        )}

        {form.rank === 'FIELD_WORKER' && (
          <div>
            <label className="label" htmlFor="trade">
              Trade
            </label>
            <select
              id="trade"
              required
              className="field"
              value={form.trade}
              onChange={(e) => update('trade', e.target.value)}
            >
              <option value="">Select a trade</option>
              {Object.entries(TRADE_LABEL).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <p className="hint">Determines which jobs their officer can allot to them.</p>
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting && <Spinner />}
          Create posting
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>

      {/* Unused variables kept honest: circles/sectors feed the counts below. */}
      <p className="text-xs text-slate-400">
        {circles.length} work circles and {sectors.length} sectors available.
      </p>
    </form>
  )
}

export default function People() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [geography, setGeography] = useState<GeographyTree[]>([])
  const [rank, setRank] = useState<Rank | ''>('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    try {
      const res = await api.users({ rank: rank || undefined, q: query || undefined, page: 1 })
      setUsers(res.items)
    } catch {
      setError('Could not load people.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    Promise.all([api.departments(), api.geography()])
      .then(([d, g]) => {
        setDepartments(d)
        setGeography(g)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 350)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    void load()
  }, [rank, query])

  async function toggleActive(target: User) {
    setBusyId(target.id)
    try {
      await api.updateUser(target.id, { isActive: !target.isActive })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this account.')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div>
      <PageHeader
        title="People"
        description="Everyone on the authority's rolls, from the CEO down to the sector crews."
        action={
          !creating && (
            <button onClick={() => setCreating(true)} className="btn-primary">
              <span aria-hidden>➕</span> Appoint someone
            </button>
          )
        }
      />

      {creating && (
        <AppointForm
          departments={departments}
          geography={geography}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void load()
          }}
        />
      )}

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <div className="card-pad mb-4 space-y-3">
        <input
          className="field"
          placeholder="Search by name or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap gap-1.5">
          {(['', ...APPOINTABLE, 'CITIZEN'] as (Rank | '')[]).map((r) => (
            <button
              key={r || 'all'}
              onClick={() => setRank(r)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                rank === r
                  ? 'bg-brand-600 text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {r === '' ? 'Everyone' : RANK_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <CardSkeleton rows={6} />
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {users
              .slice()
              .sort((a, b) => RANK_LEVEL[b.rank] - RANK_LEVEL[a.rank])
              .map((u) => {
                const p = u.primaryPosting
                return (
                  <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                        u.isActive ? 'bg-brand-100 text-brand-700' : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {initials(u.fullName)}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={`truncate text-sm font-medium ${
                            u.isActive ? 'text-slate-900' : 'text-slate-400 line-through'
                          }`}
                        >
                          {u.fullName}
                        </span>
                        <span className={`pill ${RANK_STYLE[u.rank]}`}>
                          {p?.designationTitle ?? RANK_LABEL[u.rank]}
                        </span>
                        {!u.isActive && (
                          <span className="pill bg-red-100 text-red-700">Inactive</span>
                        )}
                      </div>
                      <p className="truncate text-xs text-slate-500">
                        {u.email}
                        {p?.department && ` · ${p.department.name}`}
                        {p?.sector
                          ? ` · Sector ${p.sector.number}`
                          : p?.circle
                            ? ` · ${p.circle.name}`
                            : p?.zone
                              ? ` · ${p.zone.name}`
                              : ''}
                        {p?.employeeCode && ` · ${p.employeeCode}`}
                        {u.rank === 'CITIZEN' &&
                          u.homeSector &&
                          ` · Sector ${u.homeSector.number}`}
                      </p>
                    </div>

                    {u.id !== me?.id && (
                      <button
                        onClick={() => void toggleActive(u)}
                        disabled={busyId === u.id}
                        className={`btn-sm ${u.isActive ? 'btn-secondary' : 'btn-primary'}`}
                      >
                        {busyId === u.id && <Spinner className="h-3 w-3" />}
                        {u.isActive ? 'Deactivate' : 'Reactivate'}
                      </button>
                    )}
                  </li>
                )
              })}
          </ul>
        </div>
      )}
    </div>
  )
}
