'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, Marker, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { BROOKLYN_CENTRE, BROOKLYN_ZOOM } from '@/lib/constants'
import { formatCount } from '@/lib/format'
import type { MapCluster } from '@/types'

/**
 * Open service requests, clustered.
 *
 * The clustering happens in Postgres, not here, and that is the whole design of
 * this screen rather than an optimisation. Brooklyn holds roughly 350,000
 * located requests; handing them to Leaflet to cluster in the browser means a
 * response of tens of megabytes and a tab that stops responding. The API answers
 * with at most a couple of thousand grid cells for the current viewport, and
 * this component draws those.
 *
 * The consequence to be honest about: a marker is a **count in a cell**, not a
 * place. Its position is the centre of a grid square, so it does not mark where
 * anything is until you have zoomed far enough that the square is smaller than
 * the thing you are looking for. The label says "in this area" for that reason.
 */

/**
 * Marker size by weight.
 *
 * Area, not radius, tracks the count: a circle drawn with radius proportional to
 * a value looks like it means the square of it, and a cell holding a hundred
 * requests would swallow half the borough.
 */
function markerFor(count: number, max: number): L.DivIcon {
    const scale = max <= 1 ? 1 : Math.sqrt(count) / Math.sqrt(max)
    const size = Math.round(22 + scale * 26)
    const label = count > 999 ? `${Math.round(count / 1000)}k` : String(count)
    return L.divIcon({
        html: `<span class="cluster-dot" style="width:${size}px;height:${size}px">${label}</span>`,
        className: 'cluster-icon',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
    })
}

function Viewport({ onChange }: { onChange: (bbox: string, zoom: number) => void }) {
    const map = useMap()

    const emit = useCallback(() => {
        const bounds = map.getBounds()
        const west = bounds.getWest()
        const south = bounds.getSouth()
        const east = bounds.getEast()
        const north = bounds.getNorth()

        // A map mounted into an element that has not been laid out yet reports a
        // zero-width viewport, and the resulting bbox has west === east. The API
        // rejects that, correctly — so wait rather than ask for a rectangle with
        // no area.
        if (!(west < east && south < north)) return

        onChange([west, south, east, north].map((n) => n.toFixed(5)).join(','), map.getZoom())
    }, [map, onChange])

    useEffect(() => {
        // Leaflet caches the container's size when it initialises. Next renders
        // this inside a layout that is still settling, so without this the map
        // keeps the size it saw first — a narrow strip — and every bbox it
        // reports describes that strip rather than what the reader can see.
        //
        // The settle is debounced, and `invalidateSize` is deliberately *not*
        // called from inside the observer: it touches the panes, the observer
        // sees that as a resize, and the two drive each other round a loop that
        // cancels every request it starts. One recalculation per quiet moment is
        // what is actually wanted.
        let timer: ReturnType<typeof setTimeout> | undefined
        const settle = () => {
            clearTimeout(timer)
            timer = setTimeout(() => {
                map.invalidateSize({ animate: false })
                emit()
            }, 120)
        }

        settle()
        const observer = new ResizeObserver(settle)
        observer.observe(map.getContainer())
        return () => {
            clearTimeout(timer)
            observer.disconnect()
        }
    }, [map, emit])

    useMapEvents({ moveend: emit, zoomend: emit })
    return null
}

export function ClusterMap({ agencyLabel }: { agencyLabel: string | null }) {
    const [clusters, setClusters] = useState<MapCluster[]>([])
    const [error, setError] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const inFlight = useRef<AbortController | null>(null)

    const load = useCallback((bbox: string, zoom: number) => {
        // Panning fires faster than the network answers, and a stale response
        // arriving after a fresh one would redraw the previous viewport's dots
        // over the current one.
        inFlight.current?.abort()
        const controller = new AbortController()
        inFlight.current = controller
        setLoading(true)

        apiClient
            .clusters({ bbox, zoom, openOnly: true }, controller.signal)
            .then((rows) => {
                setClusters(rows)
                setError(null)
            })
            .catch((err: unknown) => {
                if (controller.signal.aborted) return
                setError(messageFrom(err, 'The map could not be loaded.'))
            })
            .finally(() => {
                // Only the newest request may clear the spinner. An aborted one
                // has been superseded, so the fetch that replaced it is still in
                // flight and the panel should keep saying so.
                if (inFlight.current === controller) setLoading(false)
            })
    }, [])

    useEffect(() => () => inFlight.current?.abort(), [])

    const max = useMemo(
        () => clusters.reduce((n, cluster) => Math.max(n, cluster.count), 0),
        [clusters],
    )
    const total = useMemo(
        () => clusters.reduce((n, cluster) => n + cluster.count, 0),
        [clusters],
    )

    return (
        <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13.5px] text-ink-mid">
                <span>
                    {loading ? (
                        'Loading…'
                    ) : (
                        <>
                            <span className="mono text-ink">{formatCount(total)}</span> open{' '}
                            {agencyLabel ? `${agencyLabel} ` : ''}requests in view, in{' '}
                            <span className="mono text-ink">{formatCount(clusters.length)}</span>{' '}
                            {clusters.length === 1 ? 'cluster' : 'clusters'}
                        </>
                    )}
                </span>
                <span className="text-ink-soft">
                    Each marker counts requests in a grid cell, not a single location.
                </span>
            </div>

            {error && (
                <p className="rounded-[var(--radius)] border border-stop bg-stop-soft px-4 py-3 text-[13.5px] text-stop">
                    {error}
                </p>
            )}

            <div className="h-[70vh] min-h-[420px] overflow-hidden rounded-[var(--radius)] border border-line">
                <MapContainer
                    center={BROOKLYN_CENTRE}
                    zoom={BROOKLYN_ZOOM}
                    scrollWheelZoom
                    className="h-full w-full"
                >
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Viewport onChange={load} />
                    {clusters.map((cluster) => (
                        <Marker
                            key={`${cluster.lat},${cluster.lng}`}
                            position={[cluster.lat, cluster.lng]}
                            icon={markerFor(cluster.count, max)}
                        >
                            <Tooltip direction="top">
                                {formatCount(cluster.count)} open{' '}
                                {cluster.count === 1 ? 'request' : 'requests'} in this area
                            </Tooltip>
                        </Marker>
                    ))}
                </MapContainer>
            </div>
        </div>
    )
}
