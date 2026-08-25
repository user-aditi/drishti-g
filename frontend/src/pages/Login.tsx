import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { ApiError } from '../lib/api'
import { ErrorBanner, Spinner } from '../components/ui'

/** Seeded accounts, so a reviewer can get in without reading the README. */
const DEMO_ACCOUNTS = [
  { email: 'admin@drishti.gov.in', label: 'Supervisor', hint: 'Dashboard, risk queue, audit trail' },
  { email: 'swm.ward5@drishti.gov.in', label: 'Field Official', hint: 'Task inbox for the busiest ward' },
  { email: 'citizen@example.com', label: 'Citizen', hint: 'File and track complaints' },
]

export default function Login() {
  const { login, user, loading } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (!loading && user) return <Navigate to={location.state?.from ?? '/'} replace />

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(email, password)
      navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      // An ApiError carries the server's own message. Anything else means the
      // request never arrived, which is a different fix for the user.
      setError(
        err instanceof ApiError
          ? err.message
          : 'Could not reach the server. Check that the API is running on port 4000.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  function useDemo(demoEmail: string) {
    setEmail(demoEmail)
    setPassword('drishti123')
    setError(null)
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Left: the pitch. Hidden on small screens where the form is all that matters. */}
      <div className="relative hidden flex-col justify-between bg-slate-800 p-12 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 font-bold text-white">
            दृ
          </div>
          <div>
            <div className="font-bold tracking-tight text-white">DRISHTI-G</div>
            <div className="text-xs uppercase tracking-wide text-slate-400">
              Municipal Governance Platform
            </div>
          </div>
        </div>

        <div className="max-w-md">
          <h1 className="text-3xl font-bold leading-tight text-white">
            One coordinator. One risk radar that explains itself.
          </h1>
          <p className="mt-4 leading-relaxed text-slate-300">
            Every complaint, inspection and payment flows through a single engine — so nothing
            falls between departments, and problems surface before they become expensive.
          </p>

          <dl className="mt-10 space-y-5">
            <div className="border-l-2 border-brand-500 pl-4">
              <dt className="text-sm font-semibold text-white">GCCE — the coordinator</dt>
              <dd className="mt-0.5 text-sm text-slate-400">
                Routes every action to the right desk and records why it went there.
              </dd>
            </div>
            <div className="border-l-2 border-brand-500 pl-4">
              <dt className="text-sm font-semibold text-white">GRIE — the risk radar</dt>
              <dd className="mt-0.5 text-sm text-slate-400">
                Scores wards, contractors and projects, and always shows its reasoning.
              </dd>
            </div>
          </dl>
        </div>

        <p className="text-xs text-slate-500">Capstone project · Bhopal Municipal Corporation</p>
      </div>

      {/* Right: the form. */}
      <div className="flex items-center justify-center bg-slate-100 px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-lg font-bold text-white">
              दृ
            </div>
            <h1 className="mt-3 text-xl font-bold text-slate-900">DRISHTI-G</h1>
          </div>

          <form onSubmit={submit} className="card-pad space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Sign in</h2>
              <p className="mt-0.5 text-sm text-slate-500">Access your municipal account</p>
            </div>

            {error && <ErrorBanner message={error} />}

            <div>
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="field"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                autoComplete="current-password"
                className="field"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting && <Spinner />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            <p className="text-center text-sm text-slate-600">
              New here?
              <Link to="/register" className="ml-1 font-medium text-brand-600 hover:underline">
                Create a citizen account
              </Link>
            </p>
          </form>

          <div className="mt-6">
            <p className="mb-2 text-center text-xs font-medium uppercase tracking-wide text-slate-400">
              Demo accounts
            </p>
            <div className="space-y-1.5">
              {DEMO_ACCOUNTS.map((account) => (
                <button
                  key={account.email}
                  type="button"
                  onClick={() => useDemo(account.email)}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-left transition-colors hover:border-brand-300 hover:bg-brand-50/40"
                >
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-slate-800">
                      {account.label}
                    </span>
                    <span className="block truncate text-[11px] text-slate-500">
                      {account.hint}
                    </span>
                  </span>
                  <span className="shrink-0 text-[11px] font-medium text-brand-600">Use</span>
                </button>
              ))}
            </div>
            <p className="mt-2 text-center text-[11px] text-slate-400">
              All demo accounts use the password <code className="font-mono">drishti123</code>
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
