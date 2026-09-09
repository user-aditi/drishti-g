'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import * as Icons from 'lucide-react'
import { Menu, X } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { NavItem } from './app-nav'

/** Resolve a lucide icon by name, so nav data stays serialisable. */
function NavIcon({ name, className }: { name: string; className?: string }) {
    const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[name] ?? Icons.Circle
    return <Icon className={className} aria-hidden />
}

/** Contiguous runs of items sharing a heading, in the order navFor gave them. */
function groupBySection(items: NavItem[]): { section?: string; items: NavItem[] }[] {
    const groups: { section?: string; items: NavItem[] }[] = []
    for (const item of items) {
        const last = groups[groups.length - 1]
        if (last && last.section === item.section) last.items.push(item)
        else groups.push({ section: item.section, items: [item] })
    }
    return groups
}

/**
 * The one nav entry to light up.
 *
 * Longest prefix wins, so /admin/console/staff highlights "Staff register"
 * rather than also highlighting "Control room" above it.
 */
function activeItem(items: NavItem[], pathname: string): string | null {
    let best: string | null = null
    for (const item of items) {
        const matches = pathname === item.href || pathname.startsWith(`${item.href}/`)
        if (matches && (best === null || item.href.length > best.length)) best = item.href
    }
    return best
}

interface AppSidebarProps {
    items: NavItem[]
    userName: string
    postingLine: string
    departmentName?: string | null
    departmentIcon?: string | null
}

export function AppSidebar({
    items,
    userName,
    postingLine,
    departmentName,
    departmentIcon,
}: AppSidebarProps) {
    const pathname = usePathname()
    const router = useRouter()
    const [mobileOpen, setMobileOpen] = useState(false)
    const [signingOut, setSigningOut] = useState(false)
    const activeHref = activeItem(items, pathname)

    async function signOut() {
        setSigningOut(true)
        try {
            await apiClient.logout()
        } catch {
            // Even if the call fails the cookie may already be gone; go to login
            // either way rather than stranding the user on a dead session.
        }
        router.push('/login')
        router.refresh()
    }

    const content = (
        <div className="flex h-full flex-col">
            <div className="flex h-16 items-center gap-3 px-5">
                <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-lg)] bg-[color:var(--sidebar-accent)] text-sm font-bold text-white shadow-[var(--shadow-sm)]">
                    दृ
                </div>
                <div className="leading-tight">
                    <div className="font-display text-sm font-bold tracking-tight text-[color:var(--sidebar-strong)]">
                        DRISHTI-G
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.12em] text-[color:var(--sidebar-muted)]">
                        NOIDA Authority
                    </div>
                </div>
            </div>

            {departmentName && (
                <div className="mx-3 mb-1 flex items-center gap-2 rounded-[var(--radius-lg)] bg-[color:var(--sidebar-raised)] px-3 py-2">
                    <span aria-hidden className="text-sm">
                        {departmentIcon}
                    </span>
                    <span className="truncate text-xs font-medium text-[color:var(--sidebar-foreground)]">
                        {departmentName}
                    </span>
                </div>
            )}

            <nav className="flex-1 overflow-y-auto p-3">
                {groupBySection(items).map((group, index) => (
                    <div key={group.section ?? 'main'} className={cn(index > 0 && 'mt-6')}>
                        {group.section && (
                            <div className="px-3 pb-2 font-mono text-[10px] font-medium uppercase tracking-[0.1em] text-[color:var(--sidebar-muted)]">
                                {group.section}
                            </div>
                        )}
                        <div className="space-y-0.5">
                            {group.items.map((item) => {
                                const active = item.href === activeHref
                                return (
                                    <Link
                                        key={item.href}
                                        href={item.href}
                                        onClick={() => setMobileOpen(false)}
                                        aria-current={active ? 'page' : undefined}
                                        className={cn(
                                            'relative flex items-center gap-3 rounded-[var(--radius-lg)] px-3 py-2 text-sm font-medium transition-colors',
                                            active
                                                ? 'bg-[color:var(--sidebar-accent)] text-white'
                                                : 'text-[color:var(--sidebar-foreground)] hover:bg-[color:var(--sidebar-raised)] hover:text-[color:var(--sidebar-strong)]',
                                        )}
                                    >
                                        <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                                        {item.label}
                                    </Link>
                                )
                            })}
                        </div>
                    </div>
                ))}
            </nav>

            <div className="border-t border-[color:var(--sidebar-border)] p-3">
                <div className="flex items-center gap-3 rounded-[var(--radius-lg)] px-2 py-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--sidebar-accent)] text-xs font-semibold text-white">
                        {initials(userName)}
                    </div>
                    <div className="min-w-0 flex-1 leading-tight">
                        <div className="truncate text-sm font-medium text-[color:var(--sidebar-strong)]">
                            {userName}
                        </div>
                        <div className="truncate text-[11px] text-[color:var(--sidebar-muted)]">
                            {postingLine}
                        </div>
                    </div>
                </div>
                <button
                    onClick={() => void signOut()}
                    disabled={signingOut}
                    className="mt-1 flex w-full items-center gap-2 rounded-[var(--radius-lg)] px-3 py-2 text-left text-sm font-medium text-[color:var(--sidebar-foreground)] transition-colors hover:bg-[color:var(--sidebar-raised)] hover:text-[color:var(--sidebar-strong)] disabled:opacity-60"
                >
                    <Icons.LogOut className="h-4 w-4" aria-hidden />
                    {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
            </div>
        </div>
    )

    return (
        <>
            <aside className="hidden w-64 shrink-0 bg-[color:var(--sidebar)] lg:block">
                <div className="sticky top-0 h-screen">{content}</div>
            </aside>

            <button
                onClick={() => setMobileOpen(true)}
                className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--sidebar)] text-white shadow-[var(--shadow-lg)] lg:hidden"
                aria-label="Open navigation"
            >
                <Menu className="h-5 w-5" />
            </button>

            {mobileOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div
                        className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
                        onClick={() => setMobileOpen(false)}
                        aria-hidden
                    />
                    <aside className="absolute left-0 top-0 h-full w-64 bg-[color:var(--sidebar)] shadow-[var(--shadow-lg)]">
                        <button
                            onClick={() => setMobileOpen(false)}
                            className="absolute right-3 top-4 z-10 text-[color:var(--sidebar-muted)] hover:text-white"
                            aria-label="Close navigation"
                        >
                            <X className="h-5 w-5" />
                        </button>
                        {content}
                    </aside>
                </div>
            )}
        </>
    )
}
