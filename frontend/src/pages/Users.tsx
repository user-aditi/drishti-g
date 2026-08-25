import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, api } from '../lib/api'
import { useAuth } from '../context/AuthContext'
import { CardSkeleton, ErrorBanner, PageHeader, SectionHeading, Spinner } from '../components/ui'
import { ROLE_LABEL, initials } from '../lib/format'
import type { Department, User, UserRole, Ward } from '../lib/types'

const ROLE_STYLE: Record<UserRole, string> = {
  ADMIN: 'bg-purple-100 text-purple-800',
  FIELD_OFFICIAL: 'bg-brand-100 text-brand-800',
  CITIZEN: 'bg-slate-100 text-slate-700',
}

function CreateOfficialForm({
  wards,
  departments,
  onCreated,
  onCancel,
}: {
  wards: Ward[]
  departments: Department[]
  onCreated: () => void
  onCancel: () => void
}) {
  const [form, setForm] = useState({
    fullName: '',
    email: '',
    password: '',
    role: 'FIELD_OFFICIAL' as UserRole,
    wardId: '',
    departmentId: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const update = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  // GCCE assigns work by department + ward, so an official without both would
  // never receive a task. The API refuses it; the form says so up front.
  const needsPosting = form.role === 'FIELD_OFFICIAL'

  async function submit(e: FormEvent) {
    e.preventDefault()
    setSubmitting(true)
    setError(null)
    try {
      await api.createUser({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        role: form.role,
        wardId: form.wardId ? Number(form.wardId) : null,
        departmentId: form.departmentId ? Number(form.departmentId) : null,
      })
      onCreated()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create this account.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={submit} className="card-pad mb-5 space-y-4">
      <SectionHeading
        title="Add a staff account"
        description="Officials and supervisors can only be created here — public registration always produces a citizen."
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
            placeholder="name@drishti.gov.in"
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
          <label className="label" htmlFor="role">
            Role
          </label>
          <select
            id="role"
            className="field"
            value={form.role}
            onChange={(e) => update('role', e.target.value)}
          >
            <option value="FIELD_OFFICIAL">Field Official</option>
            <option value="ADMIN">Supervisor</option>
          </select>
        </div>

        {needsPosting && (
          <>
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
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="label" htmlFor="wardId">
                Ward
              </label>
              <select
                id="wardId"
                required
                className="field"
                value={form.wardId}
                onChange={(e) => update('wardId', e.target.value)}
              >
                <option value="">Select a ward</option>
                {wards.map((w) => (
                  <option key={w.id} value={w.id}>
                    Ward {w.wardNumber} — {w.name}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      {needsPosting && (
        <p className="hint">
          GCCE routes work by department and ward together — an official needs both to receive
          tasks.
        </p>
      )}

      <div className="flex gap-2">
        <button type="submit" className="btn-primary" disabled={submitting}>
          {submitting && <Spinner />}
          Create account
        </button>
        <button type="button" onClick={onCancel} className="btn-secondary">
          Cancel
        </button>
      </div>
    </form>
  )
}

export default function Users() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<User[]>([])
  const [wards, setWards] = useState<Ward[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [role, setRole] = useState<UserRole | ''>('')
  const [creating, setCreating] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const res = await api.users({ role: role || undefined, page: 1 })
      setUsers(res.items)
    } catch {
      setError('Could not load accounts.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    Promise.all([api.wards(), api.departments()])
      .then(([w, d]) => {
        setWards(w)
        setDepartments(d)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    void load()
  }, [role])

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
        description="Citizens, field officials and supervisors."
        action={
          !creating && (
            <button onClick={() => setCreating(true)} className="btn-primary">
              <span aria-hidden>➕</span> Add staff account
            </button>
          )
        }
      />

      {creating && (
        <CreateOfficialForm
          wards={wards}
          departments={departments}
          onCancel={() => setCreating(false)}
          onCreated={() => {
            setCreating(false)
            void load()
          }}
        />
      )}

      {error && <ErrorBanner message={error} onRetry={() => void load()} />}

      <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-slate-200 bg-white p-1">
        {(
          [
            ['', 'Everyone'],
            ['CITIZEN', 'Citizens'],
            ['FIELD_OFFICIAL', 'Officials'],
            ['ADMIN', 'Supervisors'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key || 'all'}
            onClick={() => setRole(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              role === key ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <CardSkeleton rows={6} />
      ) : (
        <div className="card overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {users.map((u) => (
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
                    <span className={`pill ${ROLE_STYLE[u.role]}`}>{ROLE_LABEL[u.role]}</span>
                    {!u.isActive && <span className="pill bg-red-100 text-red-700">Inactive</span>}
                  </div>
                  <p className="truncate text-xs text-slate-500">
                    {u.email}
                    {u.department && ` · ${u.department.name}`}
                    {u.ward && ` · Ward ${u.ward.wardNumber}`}
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
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
