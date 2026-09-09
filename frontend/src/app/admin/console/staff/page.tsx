import type { Metadata } from 'next'
import { serverFetchOr } from '@/lib/api'
import { Trail } from '@/components/console/detail'
import { PageHeader } from '@/components/shared/page-header'
import type { Department, GeographyTree, Paged, StaffRow } from '@/types'
import { StaffClient } from './client'

export const metadata: Metadata = { title: 'Officers & staff · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * The establishment — never the public.
 *
 * Citizens live in their own register. The questions you ask of an officer are
 * about workload and posting; the questions you ask of a citizen are about what
 * they reported and whether it got fixed. One table cannot answer both.
 */
export default async function StaffPage({ searchParams }: { searchParams?: { rank?: string } }) {
    const params = new URLSearchParams({ page: '1', size: '500' })
    if (searchParams?.rank) params.set('rank', searchParams.rank)

    const [staff, departments, geography] = await Promise.all([
        serverFetchOr<Paged<StaffRow>>(`/console/staff?${params}`, {
            items: [],
            total: 0,
            page: 1,
            size: 500,
        }),
        serverFetchOr<Department[]>('/departments', []),
        serverFetchOr<GeographyTree[]>('/geography', []),
    ])

    // Belt and braces: the endpoint is unfiltered by rank, and the public must
    // not leak into the establishment roll.
    const officers = staff.items.filter((u) => u.rank !== 'CITIZEN')

    return (
        <div>
            <Trail items={[{ label: 'Officers & staff' }]} />
            <PageHeader
                title="Officers & staff"
                description="Everyone on the authority's rolls and the post they hold. A person and their posting are one record — someone without a posting is not on the org chart and receives no work."
            />
            <StaffClient
                staff={officers}
                total={officers.length}
                departments={departments}
                geography={geography}
                initialRank={searchParams?.rank ?? ''}
            />
        </div>
    )
}
