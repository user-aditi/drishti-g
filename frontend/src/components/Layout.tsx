import { Link, NavLink, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import type { UserRole } from '../lib/types'

const ROLE_LABELS: Record<UserRole, string> = {
  citizen: 'Citizen',
  field_official: 'Field Official',
  admin: 'Administrator',
}

// Each role sees only its own navigation. The backend enforces this too - the
// menu is a convenience, never the access control.
const NAV: Record<UserRole, { to: string; label: string }[]> = {
  citizen: [
    { to: '/', label: 'My Complaints' },
    { to: '/complaints/new', label: 'File a Complaint' },
  ],
  field_official: [
    { to: '/', label: 'My Tasks' },
    { to: '/tasks', label: 'Task Inbox' },
  ],
  admin: [
    { to: '/', label: 'Dashboard' },
    { to: '/risk', label: 'Risk Queue' },
    { to: '/users', label: 'Users' },
    { to: '/audit', label: 'Audit Trail' },
  ],
}

export default function Layout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-baseline gap-2">
            <span className="text-lg font-bold tracking-tight text-brand-700">DRISHTI-G</span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              Municipal Governance Platform
            </span>
          </Link>

          {user && (
            <div className="flex items-center gap-4">
              <nav className="hidden gap-1 sm:flex">
                {NAV[user.role].map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    className={({ isActive }) =>
                      `rounded-md px-3 py-1.5 text-sm font-medium ${
                        isActive
                          ? 'bg-brand-50 text-brand-700'
                          : 'text-slate-600 hover:bg-slate-100'
                      }`
                    }
                  >
                    {item.label}
                  </NavLink>
                ))}
              </nav>
              <div className="text-right">
                <div className="text-sm font-medium leading-tight">{user.full_name}</div>
                <div className="text-xs text-slate-500">{ROLE_LABELS[user.role]}</div>
              </div>
              <button onClick={handleLogout} className="btn-ghost">
                Sign out
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
    </div>
  )
}
