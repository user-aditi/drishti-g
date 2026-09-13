import type { Metadata } from 'next'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { AgencyFilter, agencyChoice } from '@/components/shared/agency-filter'
import { auth } from '@/lib/auth'
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
 *
 * Public since Phase 11: counts per cell over locations NYC Open Data already
 * publishes, never an individual request.
 */
export default async function MapPage({
    searchParams,
}: {
    searchParams: Record<string, string | string[] | undefined>
}) {
    const user = await auth()
    const { agencies, selected } = await agencyChoice(searchParams, user)

    return (
        <PageShell>
            <PageHeading
                title="Map"
                description={
                    selected
                        ? `Open ${selected.code} requests, clustered. Zoom in to break a cluster apart.`
                        : 'Open requests across every agency, clustered. Zoom in to break a cluster apart.'
                }
            />
            <AgencyFilter path="/map" agencies={agencies} selected={selected} />
            {/* Keyed so choosing another agency starts the map afresh. */}
            <ClusterMapLoader
                key={selected?.code ?? 'all'}
                agencyId={selected?.id ?? null}
                agencyLabel={selected?.code ?? null}
            />
        </PageShell>
    )
}
