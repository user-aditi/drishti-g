import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ApiError, api } from '../lib/api'
import type { Ward } from '../lib/types'

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({
    full_name: '',
    email: '',
    phone: '',
    password: '',
    ward_id: '',
  })
  const [wards, setWards] = useState<Ward[]>([])
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  // The ward list sits behind auth, so an anonymous visitor gets no options and
  // picks a ward later instead. Failing quietly is the right behaviour here.
  useEffect(() => {
    api
      .wards()
      .then(setWards)
      .catch(() => setWards([]))
  }, [])

  function update(key: keyof typeof form, value: string) {
    setForm((f) => ({ ...f, [key]: value }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await register({
        full_name: form.full_name,
        email: form.email,
        password: form.password,
        phone: form.phone || undefined,
        ward_id: form.ward_id ? Number(form.ward_id) : null,
      })
      navigate('/', { replace: true })
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the server.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <form onSubmit={handleSubmit} className="card w-full max-w-sm space-y-4">
        <h2 className="text-lg font-semibold">Create a citizen account</h2>

        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        <div>
          <label className="label" htmlFor="full_name">
            Full name
          </label>
          <input
            id="full_name"
            required
            minLength={2}
            className="field"
            value={form.full_name}
            onChange={(e) => update('full_name', e.target.value)}
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
            value={form.email}
            onChange={(e) => update('email', e.target.value)}
          />
        </div>

        <div>
          <label className="label" htmlFor="phone">
            Phone <span className="font-normal text-slate-400">(optional)</span>
          </label>
          <input
            id="phone"
            className="field"
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
            value={form.password}
            onChange={(e) => update('password', e.target.value)}
          />
          <p className="mt-1 text-xs text-slate-500">At least 8 characters.</p>
        </div>

        {wards.length > 0 && (
          <div>
            <label className="label" htmlFor="ward_id">
              Your ward <span className="font-normal text-slate-400">(optional)</span>
            </label>
            <select
              id="ward_id"
              className="field"
              value={form.ward_id}
              onChange={(e) => update('ward_id', e.target.value)}
            >
              <option value="">Select a ward</option>
              {wards.map((w) => (
                <option key={w.id} value={w.id}>
                  Ward {w.ward_number} &mdash; {w.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? 'Creating account...' : 'Create account'}
        </button>

        <p className="text-center text-sm text-slate-600">
          Already registered?
          <Link to="/login" className="ml-1 font-medium text-brand-600 hover:underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  )
}
