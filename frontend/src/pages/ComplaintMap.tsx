import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { CircleMarker, MapContainer, Marker, Popup, TileLayer, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api } from '../lib/api'
import { CardSkeleton, ErrorBanner, PageHeader, SectionHeading } from '../components/ui'
import { BAND_META, STATUS_META, deadlineLabel, isOpen } from '../lib/format'
import type { Department, MapPin, SectorRisk } from '../lib/types'

// Leaflet ships its marker icons as bundler-hostile relative URLs. Building a
// divIcon from our own markup avoids the broken-image problem entirely and lets
// each pin carry its category emoji.
function pinIcon(emoji: string, tone: string) {
  return L.divIcon({
    className: '',
    html: `<div style="
      display:flex;align-items:center;justify-content:center;
      width:30px;height:30px;border-radius:50% 50% 50% 0;
      transform:rotate(-45deg);
      background:${tone};border:2px solid white;
      box-shadow:0 2px 6px rgba(15,23,42,.35);
    "><span style="transform:rotate(45deg);font-size:14px;line-height:1">${emoji}</span></div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 30],
    popupAnchor: [0, -28],
  })
}

type PinTone = 'overdue' | 'escalated' | 'open' | 'done'

const PIN_TONE: Record<PinTone, string> = {
  overdue: '#dc2626',
  escalated: '#7c3aed',
  open: '#2f7f83',
  done: '#64748b',
}

function toneFor(pin: MapPin): PinTone {
  if (!isOpen(pin.status)) return 'done'
  if (pin.escalationLevel > 0) return 'escalated'
  if (pin.slaDueAt && new Date(pin.slaDueAt).getTime() < Date.now()) return 'overdue'
  return 'open'
}

/** Noida's approximate centre, so the map opens on the city rather than the ocean. */
const NOIDA_CENTRE: [number, number] = [28.5706, 77.351]

export default function ComplaintMap() {
  const [pins, setPins] = useState<MapPin[]>([])
  const [sectors, setSectors] = useState<SectorRisk[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [departmentId, setDepartmentId] = useState<number | ''>('')
  const [statusFilter, setStatusFilter] = useState<'open' | 'all'>('open')
  const [showRisk, setShowRisk] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.sectorRisk(), api.departments()])
      .then(([risk, depts]) => {
        setSectors(risk.items)
        setDepartments(depts.filter((d) => d.status === 'ACTIVE'))
      })
      .catch(() => setError('Could not load the sector layer.'))
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api
      .mapPins({ status: statusFilter, departmentId: departmentId === '' ? undefined : departmentId })
      .then((res) => {
        if (!cancelled) setPins(res.items)
      })
      .catch(() => {
        if (!cancelled) setError('Could not load complaints.')
      })
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

  return (
    <div>
      <PageHeader
        title="Map"
        description="Where complaints are, and which sectors GRIE rates as risky."
      />

      {error && <ErrorBanner message={error} />}

      <div className="card-pad mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="dept">
              Department
            </label>
            <select
              id="dept"
              className="field"
              value={departmentId}
              onChange={(e) => setDepartmentId(e.target.value === '' ? '' : Number(e.target.value))}
            >
              <option value="">All departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.icon} {d.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label" htmlFor="status">
              Show
            </label>
            <select
              id="status"
              className="field"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'open' | 'all')}
            >
              <option value="open">Open complaints only</option>
              <option value="all">Everything</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={showRisk}
                onChange={(e) => setShowRisk(e.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
              />
              Sector risk shading
            </label>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3 text-xs">
          {(
            [
              ['overdue', 'Past deadline'],
              ['escalated', 'Escalated'],
              ['open', 'On track'],
              ['done', 'Resolved'],
            ] as const
          ).map(([key, label]) => (
            <span key={key} className="flex items-center gap-1.5 text-slate-600">
              <span
                className="h-3 w-3 rounded-full border border-white shadow"
                style={{ background: PIN_TONE[key] }}
              />
              {label}
              <span className="tnum font-semibold text-slate-800">{counts[key]}</span>
            </span>
          ))}
        </div>
      </div>

      {loading && pins.length === 0 ? (
        <CardSkeleton rows={10} />
      ) : (
        <div className="card overflow-hidden" style={{ height: 560 }}>
          <MapContainer center={NOIDA_CENTRE} zoom={12} scrollWheelZoom style={{ height: '100%' }}>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* Risk shading sits underneath the pins, so a cluster of complaints
                reads against the sector's overall score rather than hiding it. */}
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
                  icon={pinIcon(pin.category?.icon ?? '📋', PIN_TONE[tone]!)}
                >
                  <Popup>
                    <div className="min-w-[200px]">
                      <p className="font-mono text-[10px] text-slate-400">{pin.referenceNo}</p>
                      <p className="mt-0.5 text-sm font-semibold leading-snug text-slate-900">
                        {pin.title}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        {STATUS_META[pin.status].label}
                        {pin.sector && ` · Sector ${pin.sector.number}`}
                      </p>
                      {pin.department && (
                        <p className="text-xs text-slate-500">
                          {pin.department.icon} {pin.department.name}
                        </p>
                      )}
                      {isOpen(pin.status) && (
                        <p
                          className={`mt-1 text-xs font-medium ${
                            deadline.tone === 'overdue' ? 'text-red-600' : 'text-slate-600'
                          }`}
                        >
                          {deadline.text}
                        </p>
                      )}
                      {pin.escalationLevel > 0 && (
                        <p className="mt-1 text-xs font-medium text-purple-700">
                          Escalated ×{pin.escalationLevel}
                        </p>
                      )}
                      <Link
                        to={`/complaints/${pin.id}`}
                        className="mt-2 inline-block text-xs font-medium text-brand-600 hover:underline"
                      >
                        Open case file →
                      </Link>
                    </div>
                  </Popup>
                </Marker>
              )
            })}
          </MapContainer>
        </div>
      )}

      <div className="mt-4">
        <SectionHeading
          title="Riskiest sectors on this map"
          description="Shaded circles above; the larger and redder, the worse the score."
        />
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {scoredSectors
            .slice()
            .sort((a, b) => b.score! - a.score!)
            .slice(0, 6)
            .map((s) => {
              const meta = BAND_META[s.band!]
              return (
                <div key={s.sectorId} className="card flex items-center gap-3 p-3">
                  <span
                    className={`tnum flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold ${meta.className}`}
                  >
                    {Math.round(s.score!)}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      Sector {s.number} — {s.name}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {s.circle} · {meta.label} risk
                    </p>
                  </div>
                </div>
              )
            })}
        </div>
      </div>
    </div>
  )
}
