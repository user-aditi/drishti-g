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
            <div className="flex h-16 items-center gap-2.5 border-b border-[color:var(--sidebar-border)] px-5">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[color:var(--primary)] text-sm font-bold text-white">
                    दृ
                </div>
                <div className="leading-tight">
                    <div className="text-sm font-bold tracking-tight text-white">DRISHTI-G</div>
                    <div className="text-[10px] uppercase tracking-wide text-[color:var(--sidebar-muted)]">
                        NOIDA Authority
                    </div>
                </div>
            </div>

            {departmentName && (
                <div className="border-b border-[color:var(--sidebar-border)] px-5 py-3">
                    <div className="flex items-center gap-2 text-xs text-[color:var(--sidebar-foreground)]">
                        <span aria-hidden>{departmentIcon}</span>
                        <span className="truncate font-medium">{departmentName}</span>
                    </div>
                </div>
            )}

            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
                {items.map((item) => {
                    const active =
                        pathname === item.href ||
                        (item.href !== '/dashboard' && pathname.startsWith(`${item.href}/`))

                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setMobileOpen(false)}
                            className={cn(
                                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                                active
                                    ? 'bg-[color:var(--sidebar-accent)] text-white'
                                    : 'text-[color:var(--sidebar-foreground)] hover:bg-white/5 hover:text-white',
                            )}
                        >
                            <NavIcon name={item.icon} className="h-4 w-4 shrink-0" />
                            {item.label}
                        </Link>
                    )
                })}
            </nav>

            <div className="border-t border-[color:var(--sidebar-border)] p-3">
                <div className="flex items-center gap-3 rounded-lg px-2 py-2">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--primary)] text-xs font-semibold text-white">
                        {initials(userName)}
                    </div>
                    <div className="min-w-0 flex-1 leading-tight">
                        <div className="truncate text-sm font-medium text-white">{userName}</div>
                        <div className="truncate text-[11px] text-[color:var(--sidebar-muted)]">
                            {postingLine}
                        </div>
                    </div>
                </div>
                <button
                    onClick={() => void signOut()}
                    disabled={signingOut}
                    className="mt-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-medium text-[color:var(--sidebar-foreground)] transition-colors hover:bg-white/5 hover:text-white disabled:opacity-60"
                >
                    <Icons.LogOut className="h-4 w-4" aria-hidden />
                    {signingOut ? 'Signing out…' : 'Sign out'}
                </button>
            </div>
        </div>
    )

    return (
        <>
            <aside className="hidden w-60 shrink-0 bg-[color:var(--sidebar)] lg:block">
                <div className="sticky top-0 h-screen">{content}</div>
            </aside>

            <button
                onClick={() => setMobileOpen(true)}
                className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-[color:var(--sidebar)] text-white shadow-lg lg:hidden"
                aria-label="Open navigation"
            >
                <Menu className="h-5 w-5" />
            </button>

            {mobileOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <div
                        className="absolute inset-0 bg-slate-900/50"
                        onClick={() => setMobileOpen(false)}
                        aria-hidden
                    />
                    <aside className="absolute left-0 top-0 h-full w-64 bg-[color:var(--sidebar)]">
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
