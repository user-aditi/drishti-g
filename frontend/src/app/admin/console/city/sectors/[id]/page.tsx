import { redirect } from 'next/navigation'
import { serverFetch } from '@/lib/api'

export const dynamic = 'force-dynamic'

/**
 * A pre-tree link, forwarded to the unit that replaced it.
 *
 * Resolved server-side because the old ids and the tree's ids are unrelated.
 * Circles no longer have a unit of their own, so they land on the zone that
 * contained them.
 */
export default async function LegacySectorsPage({ params }: { params: { id: string } }) {
    const { unitId } = await serverFetch<{ unitId: number }>(
        `/console/units/resolve/sector/${params.id}`,
    )
    redirect(`/admin/org/${unitId}`)
}
