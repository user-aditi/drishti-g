'use client'

import { useEffect, useState, useTransition } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { ComplaintCard } from '@/components/shared/complaint-card'
import { EmptyState } from '@/components/shared/page-header'
import { STATUS_META } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { Complaint, ComplaintStatus, Paged, Sector } from '@/types'

const STATUS_FILTERS: (ComplaintStatus | '')[] = [
    '',
    'ROUTED',
    'ASSIGNED',
    'IN_PROGRESS',
    'AWAITING_VERIFICATION',
    'RESOLVED',
    'CLOSED',
]

interface Filters {
    status: string
    sectorId: string
    q: string
}

export function ComplaintsBrowserClient({
    result,
    sectors,
    filters,
}: {
    result: Paged<Complaint>
    sectors: Sector[]
    filters: Filters
}) {
    const router = useRouter()
    const pathname = usePathname()
    const [pending, startTransition] = useTransition()
    const [search, setSearch] = useState(filters.q)

    /** Push the filter set into the URL, which re-runs the server fetch. */
    function apply(next: Partial<Filters & { page: number }>) {
        const params = new URLSearchParams()
        const merged = { ...filters, page: 1, ...next }
        if (merged.status) params.set('status', merged.status)
        if (merged.sectorId) params.set('sectorId', merged.sectorId)
        if (merged.q) params.set('q', merged.q)
        if (merged.page > 1) params.set('page', String(merged.page))

        startTransition(() => router.push(`${pathname}?${params}`))
    }

    // Debounce the search box so typing does not fire a navigation per keystroke.
    useEffect(() => {
        if (search === filters.q) return
        const timer = setTimeout(() => apply({ q: search }), 400)
        return () => clearTimeout(timer)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [search])

    const pages = Math.max(1, Math.ceil(result.total / result.size))

    return (
        <div>
            <Card className="mb-5 space-y-4 p-5">
                <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                        <Label htmlFor="search">Search</Label>
                        <Input
                            id="search"
                            placeholder="Title, description or reference number"
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                    </div>

                    <div>
                        <Label htmlFor="sector">Sector</Label>
                        <Select
                            id="sector"
                            value={filters.sectorId}
                            onChange={(e) => apply({ sectorId: e.target.value })}
                        >
                            <option value="">All sectors</option>
                            {sectors.map((s) => (
                                <option key={s.id} value={s.id}>
                                    Sector {s.number} — {s.name}
                                </option>
                            ))}
                        </Select>
                    </div>
                </div>

                <div className="flex flex-wrap gap-1.5">
                    {STATUS_FILTERS.map((s) => (
                        <button
                            key={s || 'all'}
                            onClick={() => apply({ status: s })}
                            className={cn(
                                'rounded-lg px-3 py-1.5 text-xs font-medium transition-colors',
                                filters.status === s
                                    ? 'bg-[color:var(--primary)] text-white'
                                    : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)] hover:bg-slate-200',
                            )}
                        >
                            {s === '' ? 'All' : STATUS_META[s].label}
                        </button>
                    ))}
                </div>
            </Card>

            {result.items.length === 0 ? (
                <EmptyState
                    icon={<SearchX className="h-10 w-10" />}
                    title="No complaints match"
                    description="Try clearing the filters or searching for something else."
                />
            ) : (
                <>
                    <div className={cn('space-y-3 transition-opacity', pending && 'opacity-60')}>
                        {result.items.map((c) => (
                            <ComplaintCard
                                key={c.id}
                                complaint={c}
                                href={`/complaints/${c.id}`}
                                showDeadline
                            />
                        ))}
                    </div>

                    <div className="mt-5 flex items-center justify-between">
                        <p className="tnum text-sm text-[color:var(--muted-foreground)]">
                            {result.total} complaint{result.total === 1 ? '' : 's'} · page {result.page} of{' '}
                            {pages}
                        </p>
                        <div className="flex gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={result.page <= 1}
                                onClick={() => apply({ page: result.page - 1 })}
                            >
                                Previous
                            </Button>
                            <Button
                                size="sm"
                                variant="outline"
                                disabled={result.page >= pages}
                                onClick={() => apply({ page: result.page + 1 })}
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    )
}
