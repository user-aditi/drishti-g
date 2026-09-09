'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { LatLngExpression } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { request } from '@/lib/api-client'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { CardSkeleton } from '@/components/ui/skeleton'
import { SectionHeading } from '@/components/shared/page-header'
import { BAND_META, NOIDA_CENTRE, STATUS_META, isOpen } from '@/lib/constants'
import { deadlineLabel } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { Department, MapPin, SectorRisk } from '@/types'

// react-leaflet touches `window` at module scope, so it cannot be server
// rendered. Loading it dynamically keeps the rest of the page a normal
// component instead of forcing the whole route to the client.
const MapContainer = dynamic(() => import('react-leaflet').then((m) => m.MapContainer), {
    ssr: false,
})
const TileLayer = dynamic(() => import('react-leaflet').then((m) => m.TileLayer), { ssr: false })
const Marker = dynamic(() => import('react-leaflet').then((m) => m.Marker), { ssr: false })
const Popup = dynamic(() => import('react-leaflet').then((m) => m.Popup), { ssr: false })
const CircleMarker = dynamic(() => import('react-leaflet').then((m) => m.CircleMarker), {
    ssr: false,
})
const Tooltip = dynamic(() => import('react-leaflet').then((m) => m.Tooltip), { ssr: false })

type PinTone = 'overdue' | 'escalated' | 'open' | 'done'

const PIN_TONE: Record<PinTone, string> = {
    overdue: '#DC2626',
    escalated: '#7C3AED',
    open: '#22666B',
    done: '#64748B',
}

const LEGEND: { key: PinTone; label: string }[] = [
    { key: 'overdue', label: 'Past deadline' },
    { key: 'escalated', label: 'Escalated' },
    { key: 'open', label: 'On track' },
    { key: 'done', label: 'Resolved' },
]

function toneFor(pin: MapPin): PinTone {
    if (!isOpen(pin.status)) return 'done'
    if (pin.escalationLevel > 0) return 'escalated'
    if (pin.slaDueAt && new Date(pin.slaDueAt).getTime() < Date.now()) return 'overdue'
    return 'open'
}

export function ComplaintMap({
    initialPins,
    sectors,
    departments,
    title = 'Map',
    description = 'Where complaints are, and which sectors GRIE rates as risky.',
    initialTotal,
}: {
    initialPins: MapPin[]
    sectors: SectorRisk[]
    departments: Department[]
    title?: string
    description?: string
    /** How many complaints match, which is not how many pins came back. */
    initialTotal?: number
}) {
    const [pins, setPins] = useState(initialPins)
    const [total, setTotal] = useState(initialTotal ?? initialPins.length)
    const [departmentId, setDepartmentId] = useState<number | ''>('')
    const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open')
    const [showRisk, setShowRisk] = useState(true)
    const [loading, setLoading] = useState(false)
    const [icons, setIcons] = useState<typeof import('leaflet') | null>(null)

    // Leaflet itself is only needed for divIcon; import it once on the client.
    useEffect(() => {
        void import('leaflet').then(setIcons)
    }, [])

    useEffect(() => {
        let cancelled = false
        setLoading(true)
        const params = new URLSearchParams({ status: statusFilter })
        if (departmentId !== '') params.set('departmentId', String(departmentId))

        request<{ items: MapPin[]; total?: number }>(`/complaints/map?${params}`)
            .then((res) => {
                if (cancelled) return
                setPins(res.items)
                setTotal(res.total ?? res.items.length)
            })
            .catch(() => undefined)
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [statusFilter, departmentId])

    const counts = useMemo(() => {
        const c: Record<PinTone, number> = { overdue: 0, escalated: 0, open: 0, done: 0 }
        for (const p of pins) c[toneFor(p)]++
        return c
    }, [pins])

    const scoredSectors = sectors.filter(
        (s) => s.score != null && s.centroidLat != null && s.centroidLon != null,
    )

    /** A teardrop pin carrying the category emoji, coloured by urgency. */
    function pinIcon(emoji: string, tone: string) {
        if (!icons) return undefined
        return icons.divIcon({
            className: '',
            html: `<div style="display:flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${tone};border:2px solid white;box-shadow:0 2px 6px rgba(15,23,42,.35)"><span style="transform:rotate(45deg);font-size:14px;line-height:1">${emoji}</span></div>`,
            iconSize: [30, 30],
            iconAnchor: [15, 30],
            popupAnchor: [0, -28],
        })
    }

    return (
        <div>
            <SectionHeading title={title} description={description} />

            <Card className="mb-4 p-5">
                <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                        <Label htmlFor="map-dept">Department</Label>
                        <Select
                            id="map-dept"
                            value={departmentId}
                            onChange={(e) =>
                                setDepartmentId(e.target.value === '' ? '' : Number(e.target.value))
                            }
                        >
                            <option value="">All departments</option>
                            {departments.map((d) => (
                                <option key={d.id} value={d.id}>
                                    {d.icon} {d.name}
                                </option>
                            ))}
                        </Select>
                    </div>

                    <div>
                        <Label htmlFor="map-status">Show</Label>
                        <Select
                            id="map-status"
                            value={statusFilter}
                            onChange={(e) => setStatusFilter(e.target.value as 'open' | 'all')}
                        >
                            <option value="open">Open complaints only</option>
                            <option value="all">Everything</option>
                        </Select>
                    </div>

                    <div className="flex items-end">
                        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-[color:var(--input)] px-3 text-sm">
                            <input
                                type="checkbox"
                                checked={showRisk}
                                onChange={(e) => setShowRisk(e.target.checked)}
                                className="h-4 w-4 rounded border-[color:var(--input)]"
                            />
                            Sector risk shading
                        </label>
                    </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-[color:var(--border)] pt-3 text-xs">
                    {LEGEND.map(({ key, label }) => (
                        <span key={key} className="flex items-center gap-1.5 text-[color:var(--muted-foreground)]">
                            <span
                                className="h-3 w-3 rounded-full border border-white shadow"
                                style={{ background: PIN_TONE[key] }}
                            />
                            {label}
                            <span className="tnum font-semibold text-[color:var(--foreground)]">
                                {counts[key]}
                            </span>
                        </span>
                    ))}
                    {loading && <span className="text-[color:var(--muted-foreground)]">updating…</span>}
                </div>

                {total > pins.length && (
                    /*
                     * Say so when the map is not showing everything.
                     *
                     * The endpoint caps how many pins it returns, and it used to
                     * report the cap as the total — so with 1,390 open
                     * complaints the map drew 1,000 and looked complete. On a
                     * screen built for oversight, quietly omitting a sixth of
                     * the city is worse than drawing nothing, because there is
                     * nothing to notice. Filtering by department narrows it
                     * enough to see everything again, which is why that is the
                     * advice rather than "scroll".
                     */
                    <p className="mt-3 border-t border-[color:var(--border)] pt-3 text-xs text-[color:var(--muted-foreground)]">
                        Showing the {pins.length.toLocaleString()} most recent of{' '}
                        <span className="tnum font-semibold text-[color:var(--foreground)]">
                            {total.toLocaleString()}
                        </span>{' '}
                        matching complaints. Filter by department to see all of them.
                    </p>
                )}
            </Card>

            {!icons ? (
                <CardSkeleton rows={10} />
            ) : (
                <Card className="overflow-hidden" style={{ height: 560 }}>
                    <MapContainer
                        center={NOIDA_CENTRE as LatLngExpression}
                        zoom={12}
                        scrollWheelZoom
                        style={{ height: '100%' }}
                    >
                        <TileLayer
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />

                        {/* Risk shading sits under the pins, so a cluster of
                            complaints reads against the sector's overall score
                            rather than hiding it. */}
                        {showRisk &&
                            scoredSectors.map((s) => {
                                const meta = BAND_META[s.band!]
                                return (
                                    <CircleMarker
                                        key={`risk-${s.sectorId}`}
                                        center={[s.centroidLat!, s.centroidLon!]}
                                        radius={18 + (s.score! / 100) * 22}
                                        pathOptions={{
                                            color: meta.hex,
                                            fillColor: meta.hex,
                                            fillOpacity: 0.14,
                                            weight: 1.5,
                                        }}
                                    >
                                        <Tooltip direction="top" offset={[0, -6]}>
                                            <span className="text-xs font-medium">
                                                Sector {s.number} — {meta.label} risk ({Math.round(s.score!)})
                                            </span>
                                        </Tooltip>
                                    </CircleMarker>
                                )
                            })}

                        {pins.map((pin) => {
                            const tone = toneFor(pin)
                            const deadline = deadlineLabel(pin.slaDueAt, isOpen(pin.status))
                            return (
                                <Marker
                                    key={pin.id}
                                    position={[pin.latitude, pin.longitude]}
                                    icon={pinIcon(pin.category?.icon ?? '📋', PIN_TONE[tone])}
                                >
                                    <Popup>
                                        <div className="min-w-[200px]">
                                            <p className="font-mono text-[10px] text-[color:var(--subtle-foreground)]">
                                                {pin.referenceNo}
                                            </p>
                                            <p className="mt-0.5 text-sm font-semibold leading-snug">
                                                {pin.title}
                                            </p>
                                            <p className="mt-1 text-xs text-[color:var(--muted-foreground)]">
                                                {STATUS_META[pin.status].label}
                                                {pin.sector && ` · Sector ${pin.sector.number}`}
                                            </p>
                                            {pin.department && (
                                                <p className="text-xs text-[color:var(--muted-foreground)]">
                                                    {pin.department.icon} {pin.department.name}
                                                </p>
                                            )}
                                            {isOpen(pin.status) && (
                                                <p
                                                    className={cn(
                                                        'mt-1 text-xs font-medium',
                                                        deadline.tone === 'overdue'
                                                            ? 'text-[color:var(--error)]'
                                                            : 'text-[color:var(--muted-foreground)]',
                                                    )}
                                                >
                                                    {deadline.text}
                                                </p>
                                            )}
                                            {pin.escalationLevel > 0 && (
                                                <p className="mt-1 text-xs font-medium text-[color:var(--escalate-fg)]">
                                                    Escalated ×{pin.escalationLevel}
                                                </p>
                                            )}
                                            <Link
                                                href={`/complaints/${pin.id}`}
                                                className="mt-2 inline-block text-xs font-medium text-[color:var(--primary)] hover:underline"
                                            >
                                                Open case file →
                                            </Link>
                                        </div>
                                    </Popup>
                                </Marker>
                            )
                        })}
                    </MapContainer>
                </Card>
            )}

            {scoredSectors.length > 0 && (
                <div className="mt-5">
                    <SectionHeading
                        title="Riskiest sectors on this map"
                        description="Shaded circles above — larger and redder means a worse score."
                    />
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {scoredSectors
                            .slice()
                            .sort((a, b) => b.score! - a.score!)
                            .slice(0, 6)
                            .map((s) => {
                                const meta = BAND_META[s.band!]
                                return (
                                    <Card key={s.sectorId} className="flex items-center gap-3 p-3">
                                        <span
                                            className={cn(
                                                'tnum flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold',
                                                meta.className,
                                            )}
                                        >
                                            {Math.round(s.score!)}
                                        </span>
                                        <div className="min-w-0">
                                            <p className="truncate text-sm font-medium">
                                                Sector {s.number} — {s.name}
                                            </p>
                                            <p className="truncate text-xs text-[color:var(--muted-foreground)]">
                                                {s.circle} · {meta.label} risk
                                            </p>
                                        </div>
                                    </Card>
                                )
                            })}
                    </div>
                </div>
            )}
        </div>
    )
}
