import type { Metadata } from 'next'
import { serverFetchOr } from '@/lib/api'
import { Trail } from '@/components/console/detail'
import { PageHeader } from '@/components/shared/page-header'
import type { CitizenRow, Paged } from '@/types'
import { CitizensClient } from './client'

export const metadata: Metadata = { title: 'Citizens · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * The public, kept apart from the establishment on purpose.
 *
 * These rows answer a different question from the staff register: not "what is
 * this person carrying" but "what did they report, and did the authority do
 * anything about it".
 */
export default async function CitizensPage() {
    const citizens = await serverFetchOr<Paged<CitizenRow>>('/console/citizens?size=1000', {
        items: [],
        total: 0,
        page: 1,
        size: 1000,
    })

    return (
        <div>
            <Trail items={[{ label: 'Citizens' }]} />
            <PageHeader
                title="Citizens"
                description="Residents registered to file. Open one to see everything they have reported and how the authority answered."
            />
            <CitizensClient citizens={citizens.items} total={citizens.total} />
        </div>
    )
}
