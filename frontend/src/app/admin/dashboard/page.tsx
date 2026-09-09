import type { Metadata } from 'next'
import Link from 'next/link'
import {
    ClipboardList,
    Landmark,
    Map as MapIcon,
    MapPin,
    Network,
    ShieldCheck,
    Users,
} from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader, StatStrip, MeterRow, type Stat } from '@/components/shared/surface'
import { PageHeader } from '@/components/shared/page-header'
import { RiskBadge } from '@/components/shared/status-badge'
import { STATUS_FUNNEL, STATUS_META, isAuthorityWide, isSeniorOfficer } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type {
    ComplaintStatus,
    EscalationInboxItem,
    OversightStats,
    RiskFlag,
    SectorPerformance,
} from '@/types'

export const metadata: Metadata = { title: 'Overview · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * Where every complaint currently stands, as a proportion of the whole.
 *
 * Each status keeps its own colour from STATUS_META, so a bar here and a badge
 * in the queue below are the same green for "resolved".
 */
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
        <div className="space-y-3">
            {rows.map(({ status, count }) => {
                const meta = STATUS_META[status]
                const pct = (count / total) * 100
                return (
                    <MeterRow
                        key={status}
                        label={meta.label}
                        value={count}
                        max={total}
                        colour={meta.hex}
                        display={
                            <>
                                {count}
                                <span className="ml-1 text-xs opacity-70">{pct.toFixed(0)}%</span>
                            </>
                        }
                    />
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

    // The headline row. Anything that is really a queue is a link, because a
    // number an officer cannot act on is a number they will stop reading.
    const headline: Stat[] = [
        {
            label: 'Complaints',
            value: complaints.total,
            hint: `${people.citizens} registered citizens`,
        },
        {
            label: 'Currently open',
            value: complaints.open,
            tone: complaints.open > 0 ? 'warning' : undefined,
            hint: `${people.officers} officers · ${people.workers} workers`,
        },
        {
            label: 'Past deadline',
            value: complaints.overdue,
            tone: complaints.overdue > 0 ? 'danger' : 'success',
            hint:
                complaints.open > 0
                    ? `${Math.round((complaints.overdue / complaints.open) * 100)}% of open work`
                    : 'Nothing overdue',
        },
        {
            label: 'Avg. resolution',
            value: avgResolutionDays == null ? '—' : `${avgResolutionDays}d`,
            hint: 'Across the last 500 resolutions',
        },
    ]

    const secondary: Stat[] = [
        ...(inbox.total > 0
            ? [
                  {
                      label: 'Escalated to you',
                      value: inbox.total,
                      tone: 'escalate' as const,
                      hint: 'A deadline was missed below you',
                      href: '/admin/escalations',
                  },
              ]
            : []),
        ...(complaints.awaitingVerification > 0
            ? [
                  {
                      label: 'Awaiting inspection',
                      value: complaints.awaitingVerification,
                      hint: 'Crews reported done, officers must verify',
                  },
              ]
            : []),
    ]

    const quickLinks = [
        { href: '/admin/map', label: 'Map', icon: MapIcon, show: true },
        { href: '/admin/org', label: 'My patch', icon: MapPin, show: true },
        { href: '/admin/complaints', label: 'All complaints', icon: ClipboardList, show: true },
        { href: '/admin/org', label: 'Org chart', icon: Network, show: isSeniorOfficer(user.rank) },
        { href: '/admin/departments', label: 'Departments', icon: Landmark, show: isAuthorityWide(user.rank) },
        { href: '/admin/people', label: 'Manage people', icon: Users, show: isAuthorityWide(user.rank) },
        { href: '/admin/audit', label: 'Audit trail', icon: ShieldCheck, show: isAuthorityWide(user.rank) },
    ].filter((l) => l.show)

    return (
        <div>
            <PageHeader
                eyebrow={`${viewer.designationTitle ?? viewer.rankLabel} · ${viewer.scopeLabel}`}
                title="Overview"
            />

            <StatStrip className="mb-4" stats={headline} />
            {secondary.length > 0 && <StatStrip className="mb-6" stats={secondary} />}

            <div className="grid gap-5 lg:grid-cols-3">
                <div className="space-y-5 lg:col-span-2">
                    <Panel flush>
                        <PanelHeader
                            sunken
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
                            <p className="px-4 py-10 text-center text-sm text-[color:var(--muted-foreground)]">
                                All clear — nothing is currently above the threshold.
                            </p>
                        ) : (
                            <table className="w-full border-collapse text-sm">
                                <caption className="sr-only">
                                    Highest-scoring entities awaiting review
                                </caption>
                                <tbody className="divide-y divide-[color:var(--border)]">
                                    {queue.items.slice(0, 5).map((flag) => (
                                        <tr
                                            key={flag.id}
                                            className="transition-colors hover:bg-[color:var(--sunken)]"
                                        >
                                            <td className="w-28 px-4 py-3 align-top">
                                                <RiskBadge band={flag.band} score={flag.score} />
                                            </td>
                                            <td className="px-4 py-3">
                                                <Link href="/admin/risk" className="block">
                                                    <span className="block truncate font-medium">
                                                        {flag.entityLabel}
                                                    </span>
                                                    <span className="mt-0.5 block text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                                                        {flag.reason}
                                                    </span>
                                                </Link>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </Panel>

                    <Panel>
                        <PanelHeader title="Where complaints stand" className="mb-4" />
                        <StatusFunnel byStatus={complaints.byStatus} total={complaints.total} />
                    </Panel>

                    {worstSectors.length > 0 && (
                        <Panel flush>
                            <PanelHeader
                                sunken
                                title="Sectors needing attention"
                                description="Ordered by how much work is past its deadline."
                                action={
                                    <Button asChild size="sm" variant="outline">
                                        <Link href="/admin/org">Open the tree</Link>
                                    </Button>
                                }
                            />
                            <div className="overflow-x-auto">
                                <table className="w-full min-w-[420px] border-collapse text-left text-sm">
                                    <thead>
                                        <tr className="border-b border-[color:var(--border)]">
                                            <th scope="col" className="label-cap px-4 py-2.5">
                                                Sector
                                            </th>
                                            <th scope="col" className="label-cap px-4 py-2.5 text-right">
                                                Open
                                            </th>
                                            <th scope="col" className="label-cap px-4 py-2.5 text-right">
                                                Overdue
                                            </th>
                                            <th scope="col" className="label-cap px-4 py-2.5 text-right">
                                                Escalated
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="tnum divide-y divide-[color:var(--border)]">
                                        {worstSectors.map((s) => (
                                            <tr key={s.sectorId}>
                                                <td className="px-4 py-3">
                                                    <span className="font-medium">Sector {s.number}</span>
                                                    <span className="ml-1.5 text-xs text-[color:var(--muted-foreground)]">
                                                        {s.circle}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-right">{s.open}</td>
                                                <td
                                                    className={cn(
                                                        'px-4 py-3 text-right',
                                                        s.overdue > 0
                                                            ? 'font-semibold text-[color:var(--error)]'
                                                            : 'text-[color:var(--subtle-foreground)]',
                                                    )}
                                                >
                                                    {s.overdue}
                                                </td>
                                                <td
                                                    className={cn(
                                                        'px-4 py-3 text-right',
                                                        s.escalated > 0
                                                            ? 'font-semibold text-[color:var(--escalate)]'
                                                            : 'text-[color:var(--subtle-foreground)]',
                                                    )}
                                                >
                                                    {s.escalated}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </Panel>
                    )}
                </div>

                <aside className="space-y-5">
                    <Panel>
                        <PanelHeader title="By department" className="mb-4" />
                        {departmentBreakdown.length === 0 ? (
                            <p className="text-sm text-[color:var(--muted-foreground)]">
                                No routed complaints yet.
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {departmentBreakdown.map((dept) => (
                                    <MeterRow
                                        key={dept.departmentId}
                                        label={
                                            <>
                                                <span aria-hidden>{dept.icon}</span> {dept.name}
                                            </>
                                        }
                                        value={dept.count}
                                        max={maxDept}
                                    />
                                ))}
                            </div>
                        )}
                    </Panel>

                    <Panel flush>
                        <PanelHeader sunken title="Jump to" />
                        <div className="p-2">
                            {quickLinks.map((link) => (
                                <Link
                                    key={`${link.href}-${link.label}`}
                                    href={link.href}
                                    className="flex items-center gap-2.5 rounded-[var(--radius-lg)] px-3 py-2 text-sm font-medium transition-colors hover:bg-[color:var(--sunken)]"
                                >
                                    <link.icon className="h-4 w-4 text-[color:var(--muted-foreground)]" />
                                    {link.label}
                                </Link>
                            ))}
                        </div>
                    </Panel>
                </aside>
            </div>
        </div>
    )
}
