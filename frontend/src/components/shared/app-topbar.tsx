'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Bell } from 'lucide-react'
import { ThemeToggle } from './theme-toggle'
import { apiClient } from '@/lib/api-client'
import { relativeTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Notification } from '@/types'

/** Path segment to a readable crumb. Anything unlisted is title-cased. */
const SEGMENT_LABEL: Record<string, string> = {
    admin: 'Oversight',
    officer: 'Section office',
    worker: 'Field work',
    dashboard: 'Overview',
    complaints: 'Complaints',
    escalations: 'Escalated to me',
    risk: 'Risk queue',
    sectors: 'Sector risk',
    org: 'Org chart',
    people: 'People',
    audit: 'Audit trail',
    departments: 'Departments',
    console: 'Control room',
    geography: 'Geography',
    organisation: 'Organisation',
    staff: 'Staff register',
    works: 'Works & contracts',
    map: 'Map',
    desk: 'My desk',
    inspect: 'Needs my decision',
    crew: 'My crew',
    done: 'Completed',
    jobs: 'Jobs',
    new: 'New',
}

function crumbsFor(pathname: string): { href: string; label: string }[] {
    // Console pages draw their own trail from the records themselves — "Zone I ›
    // Work Circle 2 › Sector 62" rather than "console / city / sectors / 7".
    // Two breadcrumbs saying different things is worse than one saying the
    // useful one, so the generic trail stands down here.
    if (pathname.startsWith('/admin/console')) return []

    const segments = pathname.split('/').filter(Boolean)
    const items: { href: string; label: string }[] = []

    let href = ''
    for (const segment of segments) {
        href = `${href}/${segment}`
        // A numeric segment is a record id; the page heading names it better
        // than a crumb can.
        if (/^\d+$/.test(segment)) continue
        items.push({
            href,
            label:
                SEGMENT_LABEL[segment] ??
                segment.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
        })
    }

    return items
}

function NotificationBell() {
    const [open, setOpen] = useState(false)
    const [items, setItems] = useState<Notification[]>([])
    const [unread, setUnread] = useState(0)
    const ref = useRef<HTMLDivElement>(null)
    const router = useRouter()

    async function load() {
        try {
            const res = await apiClient.notifications()
            setItems(res.items)
            setUnread(res.unread)
        } catch {
            // A failed poll should never break the chrome around it.
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
            await apiClient.markRead(n.id).catch(() => undefined)
            void load()
        }
        if (n.link) router.push(n.link)
    }

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setOpen((v) => !v)}
                className="relative rounded-[var(--radius-lg)] p-2 text-[color:var(--muted-foreground)] transition-colors hover:bg-[color:var(--muted)] hover:text-[color:var(--foreground)]"
                aria-label={`Notifications${unread > 0 ? `, ${unread} unread` : ''}`}
            >
                <Bell className="h-5 w-5" />
                {unread > 0 && (
                    <span className="tnum absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--error)] px-1 text-[10px] font-bold text-white">
                        {unread > 9 ? '9+' : unread}
                    </span>
                )}
            </button>

            {open && (
                <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-[var(--radius-xl)] border border-[color:var(--border)] bg-[color:var(--popover)] shadow-[var(--shadow-lg)]">
                    <div className="flex items-center justify-between border-b border-[color:var(--border)] px-4 py-2.5">
                        <span className="text-sm font-semibold">Notifications</span>
                        {unread > 0 && (
                            <button
                                onClick={async () => {
                                    await apiClient.markAllRead().catch(() => undefined)
                                    void load()
                                }}
                                className="text-xs font-medium text-[color:var(--primary)] hover:underline"
                            >
                                Mark all read
                            </button>
                        )}
                    </div>

                    <div className="max-h-96 overflow-y-auto">
                        {items.length === 0 ? (
                            <p className="px-4 py-8 text-center text-sm text-[color:var(--muted-foreground)]">
                                Nothing yet.
                            </p>
                        ) : (
                            items.map((n) => (
                                <button
                                    key={n.id}
                                    onClick={() => void openItem(n)}
                                    className={cn(
                                        'block w-full border-b border-[color:var(--border)] px-4 py-3 text-left transition-colors hover:bg-[color:var(--sunken)]',
                                        !n.isRead && 'bg-[color:var(--primary-wash)]',
                                    )}
                                >
                                    <div className="flex items-start gap-2">
                                        {!n.isRead && (
                                            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[color:var(--primary)]" />
                                        )}
                                        <div className={n.isRead ? 'pl-3.5' : ''}>
                                            <p className="text-sm font-medium leading-snug">{n.title}</p>
                                            <p className="mt-0.5 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                                                {n.body}
                                            </p>
                                            <p className="mt-1 text-[11px] text-[color:var(--muted-foreground)] opacity-70">
                                                {relativeTime(n.createdAt)}
                                            </p>
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

export function AppTopbar() {
    const pathname = usePathname()
    const crumbs = crumbsFor(pathname)

    return (
        <header className="sticky top-0 z-30 border-b border-[color:var(--border)] bg-[color:var(--card)]/80 backdrop-blur-md">
            <div className="flex h-16 items-center justify-between gap-3 px-4 sm:px-6 lg:px-8">
                <nav aria-label="Breadcrumb" className="min-w-0 overflow-x-auto">
                    <ol className="inline-flex items-center gap-1 whitespace-nowrap text-xs text-[color:var(--muted-foreground)]">
                        {crumbs.map((crumb, index) => {
                            const isLast = index === crumbs.length - 1
                            return (
                                <li key={crumb.href} className="inline-flex items-center gap-1">
                                    {isLast ? (
                                        <span className="font-semibold text-[color:var(--foreground)]">
                                            {crumb.label}
                                        </span>
                                    ) : (
                                        <Link href={crumb.href} className="hover:text-[color:var(--foreground)]">
                                            {crumb.label}
                                        </Link>
                                    )}
                                    {!isLast && <span className="opacity-50">/</span>}
                                </li>
                            )
                        })}
                    </ol>
                </nav>

                <div className="flex shrink-0 items-center gap-2">
                    <ThemeToggle className="hidden sm:inline-flex" />
                    <NotificationBell />
                </div>
            </div>
        </header>
    )
}
