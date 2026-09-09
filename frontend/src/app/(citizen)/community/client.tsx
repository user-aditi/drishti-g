'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { MapPin, Users } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shared/page-header'
import { Segmented } from '@/components/shared/controls'
import { PriorityBadge, StatusBadge } from '@/components/shared/status-badge'
import { SupportButton } from '@/components/citizen/support-button'
import { relativeTime } from '@/lib/format'
import type { CommunityFeed } from '@/types'

/**
 * Two rings, named by relation rather than by tier.
 *
 * How many tiers the authority runs is configurable, so a label like "work
 * circle" would be describing a structure that may not exist. "Where I live"
 * and "Nearby" are true at any depth.
 */
const SCOPES: { value: 'unit' | 'area'; label: string; hint: string }[] = [
    { value: 'unit', label: 'Where I live', hint: 'My own area only' },
    { value: 'area', label: 'Nearby', hint: 'The surrounding areas too' },
]

export function CommunityClient({
    feed,
    scope,
}: {
    feed: CommunityFeed
    scope: 'unit' | 'area'
}) {
    const router = useRouter()
    const pathname = usePathname()

    const mine = feed.items.filter((i) => i.inMySector)
    const nearby = feed.items.filter((i) => !i.inMySector)

    return (
        <div>
            <Segmented
                variant="pill"
                label="How wide a view"
                className="mb-5"
                value={scope}
                onChange={(next) => router.push(`${pathname}?scope=${next}`)}
                options={SCOPES.map((o) => ({ value: o.value, label: o.label }))}
            />

            {feed.items.length === 0 ? (
                <EmptyState
                    icon={<Users className="h-6 w-6" />}
                    title="No open community issues here"
                    description="When a neighbour raises something that affects the whole street, it will appear here for you to back."
                />
            ) : (
                <div className="space-y-8">
                    {mine.length > 0 && (
                        <section>
                            <h2 className="mb-3 text-sm font-semibold">
                                In {feed.home?.unitName}
                                <span className="ml-2 font-normal text-[color:var(--muted-foreground)]">
                                    you can back these
                                </span>
                            </h2>
                            <div className="space-y-3">
                                {mine.map((issue) => (
                                    <IssueCard key={issue.id} issue={issue} />
                                ))}
                            </div>
                        </section>
                    )}

                    {nearby.length > 0 && (
                        <section>
                            <h2 className="mb-1 text-sm font-semibold">Nearby sectors</h2>
                            <p className="mb-3 text-xs text-[color:var(--muted-foreground)]">
                                Same work circle, so the same Executive Engineer answers for these.
                                You can follow them, but only residents of that sector may back them.
                            </p>
                            <div className="space-y-3">
                                {nearby.map((issue) => (
                                    <IssueCard key={issue.id} issue={issue} />
                                ))}
                            </div>
                        </section>
                    )}
                </div>
            )}
        </div>
    )
}

function IssueCard({ issue }: { issue: CommunityFeed['items'][number] }) {
    return (
        <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                        {issue.category && <span aria-hidden>{issue.category.icon}</span>}
                        <Link
                            href={`/complaints/${issue.id}`}
                            className="font-semibold leading-tight hover:underline"
                        >
                            {issue.title}
                        </Link>
                        {issue.viewerIsAuthor && <Badge variant="info">Yours</Badge>}
                    </div>

                    <p className="mt-1 line-clamp-2 text-sm text-[color:var(--muted-foreground)]">
                        {issue.description}
                    </p>

                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[color:var(--muted-foreground)]">
                        <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3" aria-hidden />
                            {issue.sector ? `Sector ${issue.sector.number}` : 'Not routed'}
                        </span>
                        <span>{issue.department?.name ?? 'Awaiting routing'}</span>
                        <span>raised {relativeTime(issue.createdAt)}</span>
                    </p>
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                    <StatusBadge status={issue.status} />
                    <PriorityBadge priority={issue.priority} />
                </div>
            </div>

            <div className="mt-3 border-t border-[color:var(--border)] pt-3">
                <SupportButton
                    complaintId={issue.id}
                    supporters={issue.supporters}
                    hasSupported={issue.viewerHasSupported}
                    canSupport={issue.inMySector && !issue.viewerIsAuthor}
                    isAuthor={issue.viewerIsAuthor}
                    nextThreshold={issue.nextThreshold}
                    currentPriority={issue.priority}
                />
            </div>
        </Card>
    )
}
