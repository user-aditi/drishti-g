import type { Metadata } from 'next'
import dynamicImport from 'next/dynamic'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { Skeleton } from '@/components/ui/skeleton'
import { requireUser } from '@/lib/auth'

export const metadata: Metadata = { title: 'Map' }
export const dynamic = 'force-dynamic'

/**
 * Leaflet measures the element it mounts into and reaches for `window` while
 * doing it, so it cannot be server-rendered. Loading it browser-only is the
 * supported way round that, and the skeleton holds the same height so the page
 * does not jump when the map arrives.
 */
const ClusterMap = dynamicImport(
    () => import('./cluster-map').then((m) => m.ClusterMap),
    {
        ssr: false,
        loading: () => <Skeleton className="h-[70vh] min-h-[420px] w-full rounded-[var(--radius)]" />,
    },
)

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
            <ClusterMap agencyLabel={user.agency?.code ?? null} />
        </PageShell>
    )
}
