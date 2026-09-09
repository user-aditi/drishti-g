import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight, CirclePlus, Phone, Users } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { StatStrip } from '@/components/shared/surface'
import type { Complaint, CommunityFeed, ComplaintStats, Paged } from '@/types'
import { CitizenComplaintsClient } from './client'

export const metadata: Metadata = { title: 'My complaints · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function CitizenDashboardPage() {
    const user = await requireUser()

    // Fetched in parallel on the server, so the page arrives with its data
    // rather than flashing a spinner while the browser catches up.
    const [list, stats, feed] = await Promise.all([
        serverFetchOr<Paged<Complaint>>('/complaints?size=50', {
            items: [],
            total: 0,
            page: 1,
            size: 50,
        }),
        serverFetchOr<ComplaintStats | null>('/complaints/stats', null),
        serverFetchOr<CommunityFeed>('/citizen/community?scope=unit', {
            home: null,
            needsHomeSector: true,
            scope: 'unit',
            items: [],
        }),
    ])

    // Grievances a neighbour has raised that this person has not yet backed.
    const canBack = feed.items.filter((i) => !i.viewerHasSupported && !i.viewerIsAuthor)

    const firstName = user.fullName.split(' ')[0]

    return (
        <div>
            <PageHeader
                title={`Welcome back, ${firstName}`}
                description="Track the issues you have reported and file new ones."
                action={
                    <Button asChild>
                        <Link href="/complaints/new">
                            <CirclePlus />
                            Report an issue
                        </Link>
                    </Button>
                }
            />

            {stats && (
                <StatStrip
                    className="mb-6"
                    stats={[
                        { label: 'Total reported', value: stats.total },
                        {
                            label: 'Still open',
                            value: stats.open,
                            tone: stats.open > 0 ? 'warning' : undefined,
                        },
                        { label: 'Resolved', value: stats.resolved, tone: 'success' },
                    ]}
                />
            )}

            {list.items.length === 0 && <FirstTimeGuide />}

            {canBack.length > 0 && (
                <Link
                    href="/community"
                    className="mb-6 flex items-start gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--accent)]/50 px-4 py-3 transition-colors hover:bg-[color:var(--accent)]"
                >
                    <Users
                        className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--accent-foreground)]"
                        aria-hidden
                    />
                    <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-[color:var(--accent-foreground)]">
                            {canBack.length} {canBack.length === 1 ? 'issue' : 'issues'} in{' '}
                            {feed.home?.unitName} you could back
                        </span>
                        <span className="mt-0.5 block text-xs text-[color:var(--accent-foreground)] opacity-80">
                            Adding your name tells the authority how many households a problem
                            affects — and enough names raise how urgently it is treated.
                        </span>
                    </span>
                    <ArrowRight
                        className="mt-0.5 h-4 w-4 shrink-0 text-[color:var(--accent-foreground)]"
                        aria-hidden
                    />
                </Link>
            )}

            <CitizenComplaintsClient complaints={list.items} />
        </div>
    )
}

/**
 * The three things a resident can do here, shown only to someone with an empty
 * list.
 *
 * "Watch the works" was removed with the works page: it promised a register of
 * sanctioned projects that does not exist as real data yet, and a civic portal
 * that advertises something it cannot deliver spends trust it needs later.
 *
 * A civic portal is used a handful of times a year, so nobody arrives
 * remembering how it works. Saying it plainly once, and then getting out of the
 * way for good, beats a persistent help panel occupying the screen where their
 * complaints should be.
 */
function FirstTimeGuide() {
    const steps = [
        {
            href: '/complaints/new',
            icon: CirclePlus,
            title: 'Report something',
            body: 'Describe what you saw. We work out the department, the sector and the officer responsible.',
        },
        {
            href: '/community',
            icon: Users,
            title: 'Back your neighbours',
            body: 'Add your name to issues affecting your whole street. Enough names raise how urgently they are treated.',
        },
        {
            href: '/contacts',
            icon: Phone,
            title: 'Know who to ask',
            body: 'The officer accountable for your sector, by name — and who it reaches above them.',
        },
    ]

    return (
        <section className="mb-6">
            <h2 className="mb-3 text-sm font-semibold">What you can do here</h2>
            <div className="grid gap-3 sm:grid-cols-2">
                {steps.map((step) => (
                    <Link
                        key={step.href}
                        href={step.href}
                        className="flex items-start gap-3 rounded-xl border border-[color:var(--border)] bg-[color:var(--card)] p-4 transition-colors hover:border-[color:var(--primary)]"
                    >
                        <step.icon
                            className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--primary)]"
                            aria-hidden
                        />
                        <span className="min-w-0">
                            <span className="block text-sm font-semibold">{step.title}</span>
                            <span className="mt-0.5 block text-xs text-[color:var(--muted-foreground)]">
                                {step.body}
                            </span>
                        </span>
                    </Link>
                ))}
            </div>
        </section>
    )
}
