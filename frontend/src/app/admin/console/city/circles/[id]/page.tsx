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
export default async function LegacyCirclesPage({ params }: { params: { id: string } }) {
    const { unitId } = await serverFetch<{ unitId: number }>(
        `/console/units/resolve/circle/${params.id}`,
    )
    redirect(`/admin/org/${unitId}`)
}
