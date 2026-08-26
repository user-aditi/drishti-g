import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import type { Complaint, Paged, Sector } from '@/types'
import { ComplaintsBrowserClient } from './client'

export const metadata: Metadata = { title: 'Complaints · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * Filters live in the URL rather than in component state.
 *
 * That keeps the fetch on the server, makes a filtered view shareable with a
 * colleague, and survives the back button — all of which a purely client-side
 * filter would give up.
 */
export default async function AdminComplaintsPage({
    searchParams,
}: {
    searchParams?: { status?: string; sectorId?: string; q?: string; page?: string }
}) {
    await requireUser('CIRCLE_OFFICER')

    const page = Number(searchParams?.page ?? 1)
    const params = new URLSearchParams({ page: String(page), size: '20' })
    if (searchParams?.status) params.set('status', searchParams.status)
    if (searchParams?.sectorId) params.set('sectorId', searchParams.sectorId)
    if (searchParams?.q) params.set('q', searchParams.q)

    const [result, sectors] = await Promise.all([
        serverFetchOr<Paged<Complaint>>(`/complaints?${params}`, {
            items: [],
            total: 0,
            page,
            size: 20,
        }),
        serverFetchOr<Sector[]>('/sectors', []),
    ])

    return (
        <div>
            <PageHeader
                title="All complaints"
                description="Complaints across your jurisdiction, with the routing GCCE applied."
            />
            <ComplaintsBrowserClient
                result={result}
                sectors={sectors}
                filters={{
                    status: searchParams?.status ?? '',
                    sectorId: searchParams?.sectorId ?? '',
                    q: searchParams?.q ?? '',
                }}
            />
        </div>
    )
}
