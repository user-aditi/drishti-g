'use client'

import dynamic from 'next/dynamic'
import { Skeleton } from '@/components/ui/skeleton'

/**
 * The only job of this file is to be a client boundary.
 *
 * Leaflet reaches for `window` the moment it is imported, so the map must never
 * be evaluated on the server, and `ssr: false` is how Next is told that. But the
 * flag only takes effect when `dynamic` is called from a Client Component. The
 * page used to call it itself, and a page is a Server Component: the flag was
 * silently ignored, the map was bundled for the server anyway, and every direct
 * load of /map failed with "window is not defined". It went unnoticed because
 * reaching the map by navigating inside the app never server-renders it.
 *
 * The skeleton holds the map's height so the page does not jump when it arrives.
 */
export const ClusterMapLoader = dynamic(() => import('./cluster-map').then((m) => m.ClusterMap), {
    ssr: false,
    loading: () => <Skeleton className="h-[70vh] min-h-[420px] w-full rounded-[var(--radius)]" />,
})
