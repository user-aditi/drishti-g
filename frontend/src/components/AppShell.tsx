import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { ReactNode } from 'react'
import { useAuth } from '../context/AuthContext'
import { api } from '../lib/api'
import { RANK_LABEL, initials, isAuthorityWide, isSeniorOfficer, relativeTime } from '../lib/format'
import type { Notification, Rank, User } from '../lib/types'

interface NavItem {
  to: string
  label: string
  icon: string
}

/**
 * Navigation per rank.
 *
 * Built from the person's rank rather than a stored menu, so appointing someone
 * to a new post immediately gives them the right app. The backend enforces
 * access independently — this is a convenience, never the access control.
 */
function navFor(user: User): NavItem[] {
  const rank: Rank = user.rank

  if (rank === 'CITIZEN') {
    return [
      { to: '/', label: 'My complaints', icon: '📋' },
      { to: '/complaints/new', label: 'Report an issue', icon: '➕' },
      { to: '/departments', label: 'Departments', icon: '🏛️' },
    ]
  }

  if (rank === 'FIELD_WORKER') {
    return [
      { to: '/', label: 'My jobs', icon: '🧰' },
      { to: '/jobs/done', label: 'Completed', icon: '✅' },
    ]
  }

  if (rank === 'SECTION_OFFICER') {
    return [
      { to: '/', label: 'My desk', icon: '🗂️' },
      { to: '/desk/inspect', label: 'To inspect', icon: '🔍' },
      { to: '/map', label: 'Sector map', icon: '🗺️' },
      { to: '/desk/done', label: 'Completed', icon: '✅' },
    ]
  }

  // Circle Officer and above get oversight rather than a personal desk.
  const items: NavItem[] = [
    { to: '/', label: 'Overview', icon: '📊' },
    { to: '/escalations', label: 'Escalated to me', icon: '⬆️' },
    { to: '/complaints', label: 'Complaints', icon: '📋' },
    { to: '/map', label: 'Map', icon: '🗺️' },
    { to: '/risk', label: 'Risk queue', icon: '🎯' },
    { to: '/sectors', label: 'Sector risk', icon: '📍' },
  ]

  if (isSeniorOfficer(rank)) items.push({ to: '/org', label: 'Org chart', icon: '🏛️' })
  if (isAuthorityWide(rank)) {
    items.push({ to: '/people', label: 'People', icon: '👥' })
    items.push({ to: '/audit', label: 'Audit trail', icon: '🔒' })
  }

  return items
}

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  async function load() {
    try {
      const res = await api.notifications()
      setItems(res.items)
      setUnread(res.unread)
    } catch {
      // A failed poll should never break the shell around it.
    }
  }

  useEffect(() => {
    void load()
    const timer = setInterval(() => void load(), 30_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!open) return
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  async function openItem(n: Notification) {
    setOpen(false)
    if (!n.isRead) {
      await api.markRead(n.id).catch(() => undefined)
      void load()
    }
    if (n.link) navigate(n.link)
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700"
        aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
      >
        <span className="text-lg" aria-hidden>
          🔔
        </span>
        {unread > 0 && (
          <span className="tnum absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="animate-fade-up absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lift">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
            <span className="text-sm font-semibold">Notifications</span>
            {unread > 0 && (
              <button
                onClick={async () => {
                  await api.markAllRead().catch(() => undefined)
                  void load()
                }}
                className="text-xs font-medium text-brand-600 hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-slate-500">Nothing yet.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  onClick={() => void openItem(n)}
                  className={`block w-full border-b border-slate-50 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                    n.isRead ? '' : 'bg-brand-50/40'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {!n.isRead && (
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    )}
                    <div className={n.isRead ? 'pl-3.5' : ''}>
                      <p className="text-sm font-medium leading-snug text-slate-800">{n.title}</p>
                      <p className="mt-0.5 text-xs leading-relaxed text-slate-600">{n.body}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{relativeTime(n.createdAt)}</p>
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AppShell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  useEffect(() => setMobileOpen(false), [location.pathname])

  if (!user) return null
  const items = navFor(user)
  const posting = user.primaryPosting

  /** Where this person sits, in one line under their name. */
  const postingLine = posting
    ? [
        posting.designationTitle ?? RANK_LABEL[user.rank],
        posting.sector
          ? `Sector ${posting.sector.number}`
          : (posting.circle?.name ?? posting.zone?.name ?? null),
      ]
        .filter(Boolean)
        .join(' · ')
    : user.homeSector
      ? `Citizen · Sector ${user.homeSector.number}`
      : RANK_LABEL[user.rank]

  function handleLogout() {
    logout()
    navigate('/login', { replace: true })
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-slate-700/50 px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500 text-sm font-bold text-white">
          दृ
        </div>
        <div className="leading-tight">
          <div className="text-sm font-bold tracking-tight text-white">DRISHTI-G</div>
          <div className="text-[10px] uppercase tracking-wide text-slate-400">NOIDA Authority</div>
        </div>
      </div>

      {posting?.department && (
        <div className="border-b border-slate-700/50 px-5 py-3">
          <div className="flex items-center gap-2 text-xs text-slate-300">
            <span aria-hidden>{posting.department.icon}</span>
            <span className="truncate font-medium">{posting.department.name}</span>
          </div>
        </div>
      )}

      <nav className="flex-1 space-y-1 overflow-y-auto p-3">
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-brand-500/15 text-brand-200'
                  : 'text-slate-300 hover:bg-slate-700/50 hover:text-white'
              }`
            }
          >
            <span aria-hidden className="text-base">
              {item.icon}
            </span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-slate-700/50 p-3">
        <div className="flex items-center gap-3 rounded-lg px-2 py-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-500 text-xs font-semibold text-white">
            {initials(user.fullName)}
          </div>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-medium text-white">{user.fullName}</div>
            <div className="truncate text-[11px] text-slate-400">{postingLine}</div>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="mt-1 w-full rounded-lg px-3 py-2 text-left text-sm font-medium text-slate-300 transition-colors hover:bg-slate-700/50 hover:text-white"
        >
          Sign out
        </button>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-60 shrink-0 bg-slate-800 lg:block">
        <div className="sticky top-0 h-screen">{sidebar}</div>
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-slate-900/50"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="animate-fade-up absolute left-0 top-0 h-full w-64 bg-slate-800">
            {sidebar}
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden"
              aria-label="Open navigation"
            >
              ☰
            </button>
            <Link to="/" className="text-sm font-semibold text-slate-800 lg:hidden">
              DRISHTI-G
            </Link>
          </div>

          <div className="flex items-center gap-1">
            <NotificationBell />
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  )
}
