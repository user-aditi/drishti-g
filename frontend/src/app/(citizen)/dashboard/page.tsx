import type { Metadata } from 'next'
import Link from 'next/link'
import { CirclePlus, CircleCheck, ClipboardList, Clock } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { StatTile } from '@/components/shared/stat-tile'
import type { Complaint, ComplaintStats, Paged } from '@/types'
import { CitizenComplaintsClient } from './client'

export const metadata: Metadata = { title: 'My complaints · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function CitizenDashboardPage() {
    const user = await requireUser()

    // Fetched in parallel on the server, so the page arrives with its data
    // rather than flashing a spinner while the browser catches up.
    const [list, stats] = await Promise.all([
        serverFetchOr<Paged<Complaint>>('/complaints?size=50', {
            items: [],
            total: 0,
            page: 1,
            size: 50,
        }),
        serverFetchOr<ComplaintStats | null>('/complaints/stats', null),
    ])

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
                <div className="mb-6 grid gap-3 sm:grid-cols-3">
                    <StatTile
                        label="Total reported"
                        value={stats.total}
                        icon={<ClipboardList className="h-6 w-6" />}
                    />
                    <StatTile
                        label="Still open"
                        value={stats.open}
                        tone={stats.open > 0 ? 'warning' : 'default'}
                        icon={<Clock className="h-6 w-6" />}
                    />
                    <StatTile
                        label="Resolved"
                        value={stats.resolved}
                        tone="success"
                        icon={<CircleCheck className="h-6 w-6" />}
                    />
                </div>
            )}

            <CitizenComplaintsClient complaints={list.items} />
        </div>
    )
}
