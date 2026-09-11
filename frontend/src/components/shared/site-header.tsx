import Link from 'next/link'
import { ThemeToggle } from './theme-toggle'
import { SignOutButton } from './sign-out-button'
import { Button } from '@/components/ui/button'
import type { User } from '@/types'

/**
 * One header, three audiences.
 *
 * A visitor needs two things — file something, or check something they already
 * filed — and the header is those two things. Someone signed in gets their own
 * register added to that list, and an agent gets the three working screens.
 * Nobody gets a menu of everything: the navigation says what you can do here,
 * not what the software contains.
 *
 * The brand rule shows up in the top border: the institutional blue draws the
 * frame of the page and nothing else. It never appears as a status.
 */

interface NavLink {
    href: string
    label: string
}

const PUBLIC_LINKS: NavLink[] = [
    { href: '/file', label: 'File a request' },
    { href: '/', label: 'Look up a request' },
]

const CITIZEN_LINKS: NavLink[] = [{ href: '/my/requests', label: 'My requests' }]

/** Layer 1. Ours, not NYC's — the pages themselves say so. */
const OFFICER_LINKS: NavLink[] = [{ href: '/officer/desk', label: 'My desk' }]
const SUPERVISOR_LINKS: NavLink[] = [{ href: '/supervisor/assign', label: 'Assign' }]

const AGENT_LINKS: NavLink[] = [
    { href: '/agency/queue', label: 'Queue' },
    { href: '/boards', label: 'Community boards' },
    { href: '/map', label: 'Map' },
]

export function SiteHeader({ user }: { user: User | null }) {
    const links = [
        ...PUBLIC_LINKS,
        ...(user?.role === 'CITIZEN' ? CITIZEN_LINKS : []),
        ...(user?.role === 'AGENT' ? AGENT_LINKS : []),
        ...(user?.role === 'OFFICER' ? OFFICER_LINKS : []),
        ...(user?.role === 'SUPERVISOR' ? SUPERVISOR_LINKS : []),
    ]

    return (
        <header className="border-t-2 border-t-brand border-b border-b-line bg-surface">
            <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
                <Link href="/" className="flex items-baseline gap-2">
                    <span className="text-lg font-bold tracking-tight text-ink">311</span>
                    <span className="text-sm text-ink-soft">Service Requests</span>
                    {/* Named in the chrome, not only in the footer: someone who
                        lands mid-flow should not have to scroll to learn what
                        they are looking at. */}
                    <span className="mono text-xs text-ink-soft">replica</span>
                </Link>

                <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-2">
                    {links.map((link) => (
                        <Link
                            key={link.href}
                            href={link.href}
                            className="text-base text-ink-mid hover:text-brand hover:underline underline-offset-4"
                        >
                            {link.label}
                        </Link>
                    ))}
                </nav>

                <div className="ml-auto flex items-center gap-3">
                    <ThemeToggle />
                    {user ? (
                        <div className="flex items-center gap-3">
                            <span className="hidden text-sm text-ink-soft sm:inline">
                                {user.name}
                            </span>
                            <SignOutButton />
                        </div>
                    ) : (
                        <div className="flex items-center gap-2">
                            <Button asChild variant="quiet" size="sm">
                                <Link href="/login">Sign in</Link>
                            </Button>
                            <Button asChild variant="outline" size="sm">
                                <Link href="/register">Create account</Link>
                            </Button>
                        </div>
                    )}
                </div>
            </div>
        </header>
    )
}
