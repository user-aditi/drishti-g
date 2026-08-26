import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import type { Department, GeographyTree, Paged, User } from '@/types'
import { PeopleClient } from './client'

export const metadata: Metadata = { title: 'People · DRISHTI-G' }
export const dynamic = 'force-dynamic'

export default async function PeoplePage({
    searchParams,
}: {
    searchParams?: { rank?: string; q?: string }
}) {
    const me = await requireUser('CEO')

    const params = new URLSearchParams({ page: '1', size: '60' })
    if (searchParams?.rank) params.set('rank', searchParams.rank)
    if (searchParams?.q) params.set('q', searchParams.q)

    const [people, departments, geography] = await Promise.all([
        serverFetchOr<Paged<User>>(`/admin/users?${params}`, {
            items: [],
            total: 0,
            page: 1,
            size: 60,
        }),
        serverFetchOr<Department[]>('/departments', []),
        serverFetchOr<GeographyTree[]>('/geography', []),
    ])

    return (
        <div>
            <PageHeader
                title="People"
                description="Everyone on the authority rolls, from the CEO down to the sector crews."
            />
            <PeopleClient
                people={people.items}
                total={people.total}
                departments={departments}
                geography={geography}
                currentUserId={me.id}
                filters={{ rank: searchParams?.rank ?? '', q: searchParams?.q ?? '' }}
            />
        </div>
    )
}
