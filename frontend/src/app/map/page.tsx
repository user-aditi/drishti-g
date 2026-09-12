import type { Metadata } from 'next'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { requireUser } from '@/lib/auth'
import { ClusterMapLoader } from './map-loader'

export const metadata: Metadata = { title: 'Map' }
export const dynamic = 'force-dynamic'

/**
 * Where the open work is.
 *
 * The register answers "which requests", filtered and sorted and countable; the
 * map answers the question a register cannot, which is whether a backlog is
 * spread across a board or piled onto four streets. It shows open requests only
 * — a map of 349,000 closed ones is a map of Brooklyn.
 */
export default async function MapPage() {
    const user = await requireUser('AGENT')

    return (
        <PageShell>
            <PageHeading
                title="Map"
                description={
                    user.agency
                        ? `Open ${user.agency.code} requests, clustered. Zoom in to break a cluster apart.`
                        : 'Open requests across every agency, clustered.'
                }
            />
            <ClusterMapLoader agencyLabel={user.agency?.code ?? null} />
        </PageShell>
    )
}
