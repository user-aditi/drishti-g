'use client'

import { useEffect } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { BROOKLYN_CENTRE, BROOKLYN_ZOOM } from '@/lib/constants'

export interface Pin {
    lat: number
    lon: number
}

/**
 * A drawn pin rather than Leaflet's image marker, whose image paths a bundler
 * breaks, and in the institutional blue so it reads as "the place you chose"
 * against the tiles.
 */
const PIN = L.divIcon({
    className: '',
    html: '<span style="display:block;width:22px;height:22px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:var(--brand);border:2px solid #fff;box-shadow:0 1px 4px rgb(0 0 0 / .4)"></span>',
    iconSize: [22, 22],
    iconAnchor: [11, 22],
})

function ClickToPlace({ onChange }: { onChange: (pin: Pin) => void }) {
    useMapEvents({
        click: (event) => onChange({ lat: round(event.latlng.lat), lon: round(event.latlng.lng) }),
    })
    return null
}

/** Follow a pin set from outside the map — "use my location", or typed coordinates. */
function Follow({ pin }: { pin: Pin | null }) {
    const map = useMap()
    useEffect(() => {
        if (pin) map.setView([pin.lat, pin.lon], Math.max(map.getZoom(), 16))
    }, [map, pin])
    return null
}

const round = (value: number) => Math.round(value * 1e6) / 1e6

/**
 * Click where the problem is.
 *
 * Replaces two boxes for latitude and longitude, which nobody filing a pothole
 * report knows. The map is not keyboard-operable, so it is never the only way:
 * the wizard keeps "use my location" and typed coordinates beside it, and a pin
 * is optional — the address is what is required.
 */
export function PinPicker({ pin, onChange }: { pin: Pin | null; onChange: (pin: Pin) => void }) {
    return (
        <div
            className="h-72 w-full overflow-hidden rounded-[var(--radius)] border border-line-strong"
            role="application"
            aria-label="Map: click to place a pin where the problem is"
        >
            <MapContainer
                center={pin ? [pin.lat, pin.lon] : BROOKLYN_CENTRE}
                zoom={pin ? 16 : BROOKLYN_ZOOM}
                scrollWheelZoom={false}
                className="h-full w-full"
            >
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <ClickToPlace onChange={onChange} />
                <Follow pin={pin} />
                {pin && (
                    <Marker
                        position={[pin.lat, pin.lon]}
                        icon={PIN}
                        title="The pin: where the problem is. Drag to move it."
                        alt="The pin: where the problem is"
                        draggable
                        eventHandlers={{
                            dragend: (event) => {
                                const at = (event.target as L.Marker).getLatLng()
                                onChange({ lat: round(at.lat), lon: round(at.lng) })
                            },
                        }}
                    />
                )}
            </MapContainer>
        </div>
    )
}
