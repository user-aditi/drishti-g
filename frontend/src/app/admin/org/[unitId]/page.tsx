import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { serverFetch } from '@/lib/api'
import { ApiError } from '@/lib/api-error'
import { Trail } from '@/components/console/detail'
import type { OrgUnitDetail } from '@/types'
import { UnitClient } from './client'

export const metadata: Metadata = { title: 'Org tree · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * One unit of the authority, at any depth.
 *
 * There is deliberately only ONE page for the whole tree. A sector and the
 * whole city are the same kind of thing here — a unit with children, a roster
 * and a workload — so they get the same screen rather than three screens that
 * drift apart. Depth changes what the numbers mean, never how they are read.
 *
 * This is the drill-down the plan calls for: a table of what is inside, and the
 * full record only once you choose a row.
 */
export default async function UnitPage({ params }: { params: { unitId: string } }) {
    const id = Number(params.unitId)
    if (!Number.isInteger(id) || id <= 0) notFound()

    let detail: OrgUnitDetail
    try {
        detail = await serverFetch<OrgUnitDetail>(`/console/units/${id}`)
    } catch (err) {
        if (err instanceof ApiError && err.status === 404) notFound()
        throw err
    }

    return (
        <div>
            <Trail
                items={[
                    { label: 'Org tree', href: '/admin/org' },
                    // '/admin/org' always lands on the viewer's own entry point,
                    // so this crumb is safe for everyone.

                    ...detail.breadcrumb.slice(0, -1).map((c) => ({
                        label: c.name,
                        // Ancestors outside this officer's posting are shown for
                        // orientation but are not links — they would 403.
                        ...(c.reachable ? { href: `/admin/org/${c.id}` } : {}),
                    })),
                    { label: detail.unit.name },
                ]}
            />
            <UnitClient detail={detail} />
        </div>
    )
}
