import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ApiError, api } from '../lib/api'
import { ErrorBanner, Spinner } from '../components/ui'
import type { Sector } from '../lib/types'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    fullName: '',
    email: '',
    phone: '',
    password: '',
    homeSectorId: '',
  })
  const [sectors, setSectors] = useState<Sector[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // The sector list sits behind auth, so an anonymous visitor simply gets no
  // options and picks a sector later. Failing quietly is correct here.
  useEffect(() => {
    api
      .sectors()
      .then(setSectors)
      .catch(() => setSectors([]))
  }, [])

  const update = (key: keyof typeof form, value: string) =>
    setForm((f) => ({ ...f, [key]: value }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register({
        fullName: form.fullName,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        homeSectorId: form.homeSectorId ? Number(form.homeSectorId) : null,
      })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 px-4 py-12">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
            दृ
          </div>
          <h1 className="mt-3 text-xl font-bold text-slate-900">Create your account</h1>
          <p className="mt-1 text-sm text-slate-500">
            Report civic issues and follow them through to resolution.
          </p>
        </div>

        <form onSubmit={submit} className="card-pad space-y-4">
          {error && <ErrorBanner message={error} />}

          <div>
            <label className="label" htmlFor="fullName">
              Full name
            </label>
            <input
              id="fullName"
              required
              minLength={2}
              className="field"
              placeholder="Meera Joshi"
              value={form.fullName}
              onChange={(e) => update('fullName', e.target.value)}
            />
          </div>

          <div>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              className="field"
              placeholder="you@example.com"
              value={form.email}
              onChange={(e) => update('email', e.target.value)}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="phone">
                Phone <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <input
                id="phone"
                className="field"
                placeholder="98765 43210"
                value={form.phone}
                onChange={(e) => update('phone', e.target.value)}
              />
            </div>

            <div>
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                minLength={8}
                className="field"
                placeholder="At least 8 characters"
                value={form.password}
                onChange={(e) => update('password', e.target.value)}
              />
            </div>
          </div>

          {sectors.length > 0 && (
            <div>
              <label className="label" htmlFor="homeSectorId">
                Your sector <span className="font-normal text-slate-400">(optional)</span>
              </label>
              <select
                id="homeSectorId"
                className="field"
                value={form.homeSectorId}
                onChange={(e) => update('homeSectorId', e.target.value)}
              >
                <option value="">Select your sector</option>
                {sectors.map((s) => (
                  <option key={s.id} value={s.id}>
                    Sector {s.number} &mdash; {s.name}
                  </option>
                ))}
              </select>
              <p className="hint">
                Used to route complaints when your phone cannot supply a location.
              </p>
            </div>
          )}

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting && <Spinner />}
            {submitting ? 'Creating account…' : 'Create account'}
          </button>

          <p className="text-center text-sm text-slate-600">
            Already registered?
            <Link to="/login" className="ml-1 font-medium text-brand-600 hover:underline">
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  )
}
