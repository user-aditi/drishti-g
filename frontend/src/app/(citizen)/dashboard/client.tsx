'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Inbox, SearchX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ComplaintCard } from '@/components/shared/complaint-card'
import { EmptyState } from '@/components/shared/page-header'
import { isOpen } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { Complaint } from '@/types'

type Filter = 'all' | 'open' | 'resolved'

const FILTERS: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'open', label: 'Open' },
    { key: 'resolved', label: 'Resolved' },
]

export function CitizenComplaintsClient({ complaints }: { complaints: Complaint[] }) {
    const [filter, setFilter] = useState<Filter>('all')

    // Filtering runs here rather than on the server: a citizen's own list is
    // small enough that a round trip per tab would be slower than the render.
    const visible = complaints.filter((c) => {
        if (filter === 'open') return isOpen(c.status)
        if (filter === 'resolved') return c.status === 'RESOLVED' || c.status === 'CLOSED'
        return true
    })

    return (
        <div>
            <div className="mb-4 flex gap-1 rounded-lg border border-[color:var(--border)] bg-[color:var(--card)] p-1">
                {FILTERS.map(({ key, label }) => (
                    <button
                        key={key}
                        onClick={() => setFilter(key)}
                        className={cn(
                            'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                            filter === key
                                ? 'bg-[color:var(--primary)] text-white'
                                : 'text-[color:var(--muted-foreground)] hover:bg-[color:var(--muted)]',
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>

            {visible.length === 0 ? (
                <EmptyState
                    icon={
                        filter === 'all' ? <Inbox className="h-10 w-10" /> : <SearchX className="h-10 w-10" />
                    }
                    title={filter === 'all' ? 'No complaints yet' : `Nothing ${filter}`}
                    description={
                        filter === 'all'
                            ? 'When you report a civic issue it appears here with its full status history.'
                            : 'Try a different filter to see your other complaints.'
                    }
                    action={
                        filter === 'all' ? (
                            <Button asChild>
                                <Link href="/complaints/new">Report your first issue</Link>
                            </Button>
                        ) : undefined
                    }
                />
            ) : (
                <div className="space-y-3">
                    {visible.map((c) => (
                        <ComplaintCard key={c.id} complaint={c} href={`/complaints/${c.id}`} />
                    ))}
                </div>
            )}
        </div>
    )
}
