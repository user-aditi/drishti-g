import type { Metadata } from 'next'
import Link from 'next/link'
import {
    ArrowUpCircle,
    ClipboardList,
    Clock,
    Landmark,
    Map as MapIcon,
    MapPin,
    Network,
    SearchCheck,
    ShieldCheck,
    TriangleAlert,
    Users,
    Zap,
} from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeader, SectionHeading } from '@/components/shared/page-header'
import { StatTile } from '@/components/shared/stat-tile'
import { RiskBadge } from '@/components/shared/status-badge'
import { STATUS_FUNNEL, STATUS_META, isAuthorityWide, isSeniorOfficer } from '@/lib/constants'
import type {
    ComplaintStatus,
    EscalationInboxItem,
    OversightStats,
    RiskFlag,
    SectorPerformance,
} from '@/types'

export const metadata: Metadata = { title: 'Overview · DRISHTI-G' }
export const dynamic = 'force-dynamic'

function StatusFunnel({
    byStatus,
    total,
}: {
    byStatus: Record<ComplaintStatus, number>
    total: number
}) {
    const rows = STATUS_FUNNEL.map((status) => ({ status, count: byStatus[status] ?? 0 })).filter(
        (r) => r.count > 0,
    )

    if (total === 0) {
        return <p className="text-sm text-[color:var(--muted-foreground)]">No complaints recorded yet.</p>
    }

    return (
        <div className="space-y-2.5">
            {rows.map(({ status, count }) => {
                const meta = STATUS_META[status]
                const pct = (count / total) * 100
                return (
                    <div key={status}>
                        <div className="flex items-baseline justify-between text-sm">
                            <span className="font-medium">{meta.label}</span>
                            <span className="tnum text-[color:var(--muted-foreground)]">
                                {count}
                                <span className="ml-1 text-xs opacity-70">{pct.toFixed(0)}%</span>
                            </span>
                        </div>
                        <div className="mt-1 h-2 overflow-hidden rounded-full bg-[color:var(--muted)]">
                            <div
                                className="h-full rounded-full"
                                style={{ width: `${Math.max(pct, 1.5)}%`, background: meta.hex }}
                            />
                        </div>
                    </div>
                )
            })}
        </div>
    )
}

/**
 * Oversight for Circle Officer and above.
 *
 * One page serves every senior rank — the API scopes its numbers to whatever
 * the caller's postings cover, so an Executive Engineer sees their circle and
 * the CEO sees the authority without a separate screen.
 */
export default async function AdminDashboardPage() {
    const user = await requireUser('CIRCLE_OFFICER')

    const [stats, queue, performance, inbox] = await Promise.all([
        serverFetchOr<OversightStats | null>('/admin/stats', null),
        serverFetchOr<{ items: RiskFlag[] }>('/risk/queue', { items: [] }),
        serverFetchOr<{ items: SectorPerformance[] }>('/admin/sector-performance', { items: [] }),
        serverFetchOr<{ items: EscalationInboxItem[]; total: number }>('/admin/escalations', {
            items: [],
            total: 0,
        }),
    ])

    if (!stats) {
        return (
            <div>
                <PageHeader title="Overview" />
                <p className="text-sm text-[color:var(--muted-foreground)]">
                    Could not load the dashboard. Check that the API is running.
                </p>
            </div>
        )
    }

    const { complaints, people, departmentBreakdown, avgResolutionDays, viewer } = stats
    const maxDept = Math.max(...departmentBreakdown.map((d) => d.count), 1)
    const worstSectors = performance.items.slice(0, 5)

    const quickLinks = [
        { href: '/admin/map', label: 'Map', icon: MapIcon, show: true },
        { href: '/admin/sectors', label: 'Sector risk', icon: MapPin, show: true },
        { href: '/admin/complaints', label: 'All complaints', icon: ClipboardList, show: true },
        { href: '/admin/org', label: 'Org chart', icon: Network, show: isSeniorOfficer(user.rank) },
        { href: '/admin/departments', label: 'Departments', icon: Landmark, show: isAuthorityWide(user.rank) },
        { href: '/admin/people', label: 'Manage people', icon: Users, show: isAuthorityWide(user.rank) },
        { href: '/admin/audit', label: 'Audit trail', icon: ShieldCheck, show: isAuthorityWide(user.rank) },
    ].filter((l) => l.show)

    return (
        <div>
            <PageHeader
                title="Overview"
                description={`${viewer.designationTitle ?? viewer.rankLabel} · ${viewer.scopeLabel}`}
            />

            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <StatTile
                    label="Complaints"
                    value={complaints.total}
                    hint={`${people.citizens} registered citizens`}
                    icon={<ClipboardList className="h-6 w-6" />}
                />
                <StatTile
                    label="Currently open"
                    value={complaints.open}
                    tone={complaints.open > 0 ? 'warning' : 'default'}
                    hint={`${people.officers} officers · ${people.workers} workers`}
                    icon={<Clock className="h-6 w-6" />}
                />
                <StatTile
                    label="Past deadline"
                    value={complaints.overdue}
                    tone={complaints.overdue > 0 ? 'danger' : 'success'}
                    hint={
                        complaints.open > 0
                            ? `${Math.round((complaints.overdue / complaints.open) * 100)}% of open work`
                            : 'Nothing overdue'
                    }
                    icon={<TriangleAlert className="h-6 w-6" />}
                />
                <StatTile
                    label="Avg. resolution"
                    value={avgResolutionDays == null ? '—' : `${avgResolutionDays}d`}
                    hint="Across the last 500 resolutions"
                    icon={<Zap className="h-6 w-6" />}
                />
            </div>

            {(inbox.total > 0 || complaints.awaitingVerification > 0) && (
                <div className="mb-6 grid gap-3 sm:grid-cols-2">
                    {inbox.total > 0 && (
                        <StatTile
                            label="Escalated to you"
                            value={inbox.total}
                            tone="purple"
                            hint="A deadline was missed below you"
                            icon={<ArrowUpCircle className="h-6 w-6" />}
                            href="/admin/escalations"
                        />
                    )}
                    {complaints.awaitingVerification > 0 && (
                        <StatTile
                            label="Awaiting inspection"
                            value={complaints.awaitingVerification}
                            hint="Crews reported done, officers must verify"
                            icon={<SearchCheck className="h-6 w-6" />}
                        />
                    )}
                </div>
            )}

            <div className="grid gap-5 lg:grid-cols-3">
                <div className="space-y-5 lg:col-span-2">
                    <Card className="p-5">
                        <SectionHeading
                            title="Risk review queue"
                            description={
                                stats.pendingFlags === 0
                                    ? 'Nothing is above the review threshold.'
                                    : `${stats.pendingFlags} item${stats.pendingFlags === 1 ? '' : 's'} GRIE wants a human to look at.`
                            }
                            action={
                                <Button asChild size="sm" variant="outline">
                                    <Link href="/admin/risk">Open queue</Link>
                                </Button>
                            }
                        />

                        {queue.items.length === 0 ? (
                            <div className="rounded-lg bg-emerald-50 px-4 py-6 text-center">
                                <p className="text-sm font-medium text-emerald-800">All clear</p>
                                <p className="mt-0.5 text-xs text-emerald-700">
                                    Nothing is currently above the threshold.
                                </p>
                            </div>
                        ) : (
                            <ul className="divide-y divide-[color:var(--border)]">
                                {queue.items.slice(0, 4).map((flag) => (
                                    <li key={flag.id}>
                                        <Link
                                            href="/admin/risk"
                                            className="-mx-2 flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-[color:var(--muted)]"
                                        >
                                            <RiskBadge band={flag.band} score={flag.score} />
                                            <div className="min-w-0 flex-1">
                                                <p className="truncate text-sm font-medium">{flag.entityLabel}</p>
                                                <p className="mt-0.5 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                                                    {flag.reason}
                                                </p>
                                            </div>
                                        </Link>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </Card>

                    <Card className="p-5">
                        <SectionHeading title="Where complaints stand" />
                        <StatusFunnel byStatus={complaints.byStatus} total={complaints.total} />
                    </Card>

                    {worstSectors.length > 0 && (
                        <Card className="p-5">
                            <SectionHeading
                                title="Sectors needing attention"
                                description="Ordered by how much work is past its deadline."
                                action={
                                    <Button asChild size="sm" variant="outline">
                                        <Link href="/admin/sectors">All sectors</Link>
                                    </Button>
                                }
                            />
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[420px] text-left text-sm">
                                    <thead>
                                        <tr className="border-b border-[color:var(--border)] text-xs text-[color:var(--muted-foreground)]">
                                            <th className="pb-2 pr-3 font-medium">Sector</th>
                                            <th className="pb-2 pr-3 text-right font-medium">Open</th>
                                            <th className="pb-2 pr-3 text-right font-medium">Overdue</th>
                                            <th className="pb-2 text-right font-medium">Escalated</th>
                                        </tr>
                                    </thead>
                                    <tbody className="tnum divide-y divide-[color:var(--border)]">
                                        {worstSectors.map((s) => (
                                            <tr key={s.sectorId}>
                                                <td className="py-2 pr-3">
                                                    <span className="font-medium">Sector {s.number}</span>
                                                    <span className="ml-1.5 text-xs text-[color:var(--muted-foreground)]">
                                                        {s.circle}
                                                    </span>
                                                </td>
                                                <td className="py-2 pr-3 text-right">{s.open}</td>
                                                <td
                                                    className={
                                                        s.overdue > 0
                                                            ? 'py-2 pr-3 text-right font-semibold text-red-600'
                                                            : 'py-2 pr-3 text-right opacity-50'
                                                    }
                                                >
                                                    {s.overdue}
                                                </td>
                                                <td
                                                    className={
                                                        s.escalated > 0
                                                            ? 'py-2 text-right font-semibold text-purple-700'
                                                            : 'py-2 text-right opacity-50'
                                                    }
                                                >
                                                    {s.escalated}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Card>
                    )}
                </div>

                <aside className="space-y-5">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">By department</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {departmentBreakdown.length === 0 ? (
                                <p className="text-sm text-[color:var(--muted-foreground)]">
                                    No routed complaints yet.
                                </p>
                            ) : (
                                <ul className="space-y-2.5">
                                    {departmentBreakdown.map((dept) => (
                                        <li key={dept.departmentId}>
                                            <div className="flex items-baseline justify-between text-sm">
                                                <span className="truncate font-medium">
                                                    <span aria-hidden>{dept.icon}</span> {dept.name}
                                                </span>
                                                <span className="tnum ml-2 text-[color:var(--muted-foreground)]">
                                                    {dept.count}
                                                </span>
                                            </div>
                                            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-[color:var(--muted)]">
                                                <div
                                                    className="h-full rounded-full bg-[color:var(--primary)]"
                                                    style={{ width: `${(dept.count / maxDept) * 100}%` }}
                                                />
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </CardContent>
                    </Card>

                    <Card>
                        <CardHeader>
                            <CardTitle className="text-sm">Jump to</CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-1">
                            {quickLinks.map((link) => (
                                <Link
                                    key={link.href}
                                    href={link.href}
                                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors hover:bg-[color:var(--muted)]"
                                >
                                    <link.icon className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                                    {link.label}
                                </Link>
                            ))}
                        </CardContent>
                    </Card>
                </aside>
            </div>
        </div>
    )
}
