'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, Check } from 'lucide-react'
import { apiClient } from '@/lib/api-client'
import { messageFrom } from '@/lib/api-error'
import { BROOKLYN_BOUNDS, CHANNEL_LABEL, FILEABLE_CHANNELS } from '@/lib/constants'
import { formatHours } from '@/lib/format'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { ErrorNotice, InfoNotice } from '@/components/shared/notices'
import { SlaNote } from '@/components/shared/sla-note'
import { SrNumber } from '@/components/shared/request-bits'
import { Field } from '@/components/shared/page-heading'
import type { Board, Channel, NewRequest, RequestType, ServiceRequest } from '@/types'

/**
 * Filing, in the order 311 actually asks.
 *
 * Type first, because it decides everything downstream — which agency handles
 * it, which descriptors exist, and what deadline gets derived. Then the
 * descriptor, then where, then how it was reported, then a confirmation that
 * shows the whole thing back before anything is created.
 *
 * One step at a time rather than one long form: the descriptor list is
 * meaningless until a type is chosen, and a form that greys out two thirds of
 * itself is a worse way to say so than simply not asking yet.
 */

type Step = 'type' | 'descriptor' | 'location' | 'channel' | 'confirm'

const ORDER: Step[] = ['type', 'descriptor', 'location', 'channel', 'confirm']

const STEP_LABEL: Record<Step, string> = {
    type: 'Problem',
    descriptor: 'Details',
    location: 'Location',
    channel: 'Reported by',
    confirm: 'Confirm',
}

export function FileWizard({ types, boards }: { types: RequestType[]; boards: Board[] }) {
    const [step, setStep] = useState<Step>('type')
    const [typeId, setTypeId] = useState<number | null>(null)
    const [descriptorId, setDescriptorId] = useState<number | null>(null)
    const [address, setAddress] = useState('')
    const [zip, setZip] = useState('')
    const [orgUnitId, setOrgUnitId] = useState<number | ''>('')
    const [latitude, setLatitude] = useState('')
    const [longitude, setLongitude] = useState('')
    const [channel, setChannel] = useState<Channel>('ONLINE')

    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [filed, setFiled] = useState<ServiceRequest | null>(null)

    const type = useMemo(() => types.find((t) => t.id === typeId) ?? null, [types, typeId])
    const descriptor = type?.descriptors.find((d) => d.id === descriptorId) ?? null
    const board = boards.find((b) => b.id === orgUnitId) ?? null

    // A typed coordinate outside Brooklyn is almost always a transposed pair or
    // a missing minus sign, and sending it would put a dot in the Atlantic.
    const coords = parseCoordinates(latitude, longitude)
    const coordsOutside =
        coords !== null &&
        (coords.lat < BROOKLYN_BOUNDS.south ||
            coords.lat > BROOKLYN_BOUNDS.north ||
            coords.lon < BROOKLYN_BOUNDS.west ||
            coords.lon > BROOKLYN_BOUNDS.east)
    const coordsBroken = (latitude.trim() !== '' || longitude.trim() !== '') && coords === null

    const index = ORDER.indexOf(step)

    function canLeave(current: Step): boolean {
        if (current === 'type') return typeId !== null
        if (current === 'location') return address.trim().length > 0 && !coordsBroken
        return true
    }

    function go(direction: 1 | -1) {
        const next = ORDER[index + direction]
        if (next) setStep(next)
    }

    async function submit() {
        if (!typeId) return
        setSubmitting(true)
        setError(null)

        const body: NewRequest = {
            typeId,
            channel,
            ...(descriptorId ? { descriptorId } : {}),
            ...(address.trim() ? { address: address.trim() } : {}),
            ...(zip.trim() ? { zip: zip.trim() } : {}),
            ...(orgUnitId !== '' ? { orgUnitId } : {}),
            ...(coords ? { latitude: coords.lat, longitude: coords.lon } : {}),
        }

        try {
            setFiled(await apiClient.file(body))
        } catch (err) {
            setError(messageFrom(err, 'The request could not be filed.'))
        } finally {
            setSubmitting(false)
        }
    }

    if (filed) return <Receipt request={filed} />

    return (
        <div className="flex flex-col gap-6">
            <StepBar current={step} />

            {step === 'type' && (
                <Panel>
                    <PanelHeader>
                        <PanelTitle>What is the problem?</PanelTitle>
                    </PanelHeader>
                    <PanelBody>
                        <fieldset className="flex flex-col gap-2">
                            <legend className="sr-only">Complaint type</legend>
                            {types.map((option) => (
                                <label
                                    key={option.id}
                                    className={cn(
                                        'flex cursor-pointer items-start gap-3 rounded-[var(--radius)] border p-3',
                                        typeId === option.id
                                            ? 'border-brand bg-brand-soft'
                                            : 'border-line hover:bg-sunk',
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="type"
                                        value={option.id}
                                        checked={typeId === option.id}
                                        onChange={() => {
                                            setTypeId(option.id)
                                            setDescriptorId(null)
                                        }}
                                        className="mt-1 h-4 w-4 accent-[var(--brand)]"
                                    />
                                    <span className="flex flex-col gap-0.5">
                                        <span className="text-base font-medium text-ink">
                                            {option.name}
                                        </span>
                                        <span className="text-sm text-ink-soft">
                                            Handled by {option.agency?.name ?? 'an agency'}{' '}
                                            <span className="mono">({option.agency?.code ?? '—'})</span> ·
                                            typically closed within{' '}
                                            <span className="mono">
                                                {formatHours(option.slaHours)}
                                            </span>
                                            <span aria-hidden> †</span>
                                        </span>
                                    </span>
                                </label>
                            ))}
                        </fieldset>

                        {/* The "typically closed within" figures above are ours,
                            not the City's. Said here, at the moment they are
                            first shown. */}
                        <SlaNote
                            className="mt-4"
                            slaNote={type?.slaNote}
                            label="Where these timings come from"
                        />
                    </PanelBody>
                </Panel>
            )}

            {step === 'descriptor' && (
                <Panel>
                    <PanelHeader>
                        <PanelTitle>Which best describes it?</PanelTitle>
                    </PanelHeader>
                    <PanelBody>
                        {type && type.descriptors.length > 0 ? (
                            <fieldset className="flex flex-col gap-2">
                                <legend className="mb-2 text-base text-ink-mid">
                                    {type.name} — pick the closest match, or skip this step.
                                </legend>
                                {type.descriptors.map((option) => (
                                    <label
                                        key={option.id}
                                        className={cn(
                                            'flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border p-2.5',
                                            descriptorId === option.id
                                                ? 'border-brand bg-brand-soft'
                                                : 'border-line hover:bg-sunk',
                                        )}
                                    >
                                        <input
                                            type="radio"
                                            name="descriptor"
                                            value={option.id}
                                            checked={descriptorId === option.id}
                                            onChange={() => setDescriptorId(option.id)}
                                            className="h-4 w-4 accent-[var(--brand)]"
                                        />
                                        <span className="text-base text-ink">{option.name}</span>
                                    </label>
                                ))}
                                {descriptorId !== null && (
                                    <Button
                                        type="button"
                                        variant="quiet"
                                        size="sm"
                                        className="mt-1 self-start"
                                        onClick={() => setDescriptorId(null)}
                                    >
                                        Clear selection
                                    </Button>
                                )}
                            </fieldset>
                        ) : (
                            <p className="prose-measure text-base text-ink-soft">
                                There are no published descriptors for {type?.name ?? 'this type'}.
                                Continue to the next step.
                            </p>
                        )}
                    </PanelBody>
                </Panel>
            )}

            {step === 'location' && (
                <Panel>
                    <PanelHeader>
                        <PanelTitle>Where is it?</PanelTitle>
                    </PanelHeader>
                    <PanelBody className="flex flex-col gap-4">
                        <div>
                            <Label htmlFor="address">
                                Address or nearest intersection{' '}
                                <span className="text-stop">*</span>
                            </Label>
                            <Input
                                id="address"
                                required
                                value={address}
                                onChange={(event) => setAddress(event.target.value)}
                                placeholder="e.g. 1201 Bedford Ave, or Fulton St at Nostrand Ave"
                                autoComplete="street-address"
                            />
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <Label htmlFor="zip">ZIP code</Label>
                                <Input
                                    id="zip"
                                    value={zip}
                                    onChange={(event) => setZip(event.target.value)}
                                    inputMode="numeric"
                                    maxLength={5}
                                    placeholder="11216"
                                    className="mono"
                                    autoComplete="postal-code"
                                />
                            </div>
                            <div>
                                <Label htmlFor="board">Community board</Label>
                                <Select
                                    id="board"
                                    value={orgUnitId}
                                    onChange={(event) =>
                                        setOrgUnitId(
                                            event.target.value === '' ? '' : Number(event.target.value),
                                        )
                                    }
                                >
                                    <option value="">I do not know</option>
                                    {boards.map((option) => (
                                        <option key={option.id} value={option.id}>
                                            {option.code} — {option.name}
                                        </option>
                                    ))}
                                </Select>
                            </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                                <Label htmlFor="lat">Latitude (optional)</Label>
                                <Input
                                    id="lat"
                                    value={latitude}
                                    onChange={(event) => setLatitude(event.target.value)}
                                    inputMode="decimal"
                                    placeholder="40.6782"
                                    className="mono"
                                />
                            </div>
                            <div>
                                <Label htmlFor="lon">Longitude (optional)</Label>
                                <Input
                                    id="lon"
                                    value={longitude}
                                    onChange={(event) => setLongitude(event.target.value)}
                                    inputMode="decimal"
                                    placeholder="-73.9442"
                                    className="mono"
                                />
                            </div>
                        </div>

                        {coordsBroken && (
                            <ErrorNotice
                                title="Those coordinates are not readable"
                                message="Enter both latitude and longitude as decimal numbers, or leave both blank."
                            />
                        )}
                        {coordsOutside && (
                            <InfoNotice>
                                That point is outside Brooklyn. Check whether the two numbers are
                                the wrong way round, or whether the longitude is missing its minus
                                sign.
                            </InfoNotice>
                        )}
                    </PanelBody>
                </Panel>
            )}

            {step === 'channel' && (
                <Panel>
                    <PanelHeader>
                        <PanelTitle>How was this reported?</PanelTitle>
                    </PanelHeader>
                    <PanelBody>
                        <fieldset className="flex flex-col gap-2">
                            <legend className="mb-2 prose-measure text-base text-ink-mid">
                                NYC records the channel a request arrived through. If you are
                                entering this on someone else&apos;s behalf — a phone call taken at
                                a desk, for instance — record how it reached you.
                            </legend>
                            {FILEABLE_CHANNELS.map((option) => (
                                <label
                                    key={option}
                                    className={cn(
                                        'flex cursor-pointer items-center gap-3 rounded-[var(--radius)] border p-2.5',
                                        channel === option
                                            ? 'border-brand bg-brand-soft'
                                            : 'border-line hover:bg-sunk',
                                    )}
                                >
                                    <input
                                        type="radio"
                                        name="channel"
                                        value={option}
                                        checked={channel === option}
                                        onChange={() => setChannel(option)}
                                        className="h-4 w-4 accent-[var(--brand)]"
                                    />
                                    <span className="text-base text-ink">
                                        {CHANNEL_LABEL[option]}
                                    </span>
                                </label>
                            ))}
                        </fieldset>
                    </PanelBody>
                </Panel>
            )}

            {step === 'confirm' && type && (
                <Panel>
                    <PanelHeader>
                        <PanelTitle>Check before filing</PanelTitle>
                    </PanelHeader>
                    <PanelBody className="flex flex-col gap-4">
                        <dl className="flex flex-col">
                            <Field label="Problem">{type.name}</Field>
                            <Field label="Details">{descriptor?.name ?? 'Not specified'}</Field>
                            <Field label="Agency">
                                {type.agency?.name ?? 'Unrouted'}{' '}
                                <span className="mono text-sm text-ink-soft">
                                    ({type.agency?.code ?? '—'})
                                </span>
                            </Field>
                            <Field label="Address">{address || 'Not given'}</Field>
                            <Field label="ZIP" mono>
                                {zip || '—'}
                            </Field>
                            <Field label="Community board">
                                {board ? `${board.code} — ${board.name}` : 'Not given'}
                            </Field>
                            <Field label="Coordinates" mono>
                                {coords ? `${coords.lat}, ${coords.lon}` : '—'}
                            </Field>
                            <Field label="Reported by">{CHANNEL_LABEL[channel]}</Field>
                            <Field label="Derived deadline †">
                                <span className="mono text-sm">{formatHours(type.slaHours)}</span>{' '}
                                <span className="text-sm text-ink-soft">from filing</span>
                            </Field>
                        </dl>

                        <SlaNote slaNote={type.slaNote} />

                        <InfoNotice>
                            Filing here creates a record inside an academic replica. It is not sent
                            to the City of New York and no agency will act on it.
                        </InfoNotice>

                        {error && <ErrorNotice message={error} />}
                    </PanelBody>
                </Panel>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                    type="button"
                    variant="outline"
                    onClick={() => go(-1)}
                    disabled={index === 0 || submitting}
                >
                    <ArrowLeft aria-hidden />
                    Back
                </Button>

                {step === 'confirm' ? (
                    <Button type="button" onClick={submit} disabled={submitting}>
                        {submitting ? 'Filing…' : 'File this request'}
                        {!submitting && <Check aria-hidden />}
                    </Button>
                ) : (
                    <Button type="button" onClick={() => go(1)} disabled={!canLeave(step)}>
                        Continue
                        <ArrowRight aria-hidden />
                    </Button>
                )}
            </div>
        </div>
    )
}

/** Where the reader is, and how much is left. */
function StepBar({ current }: { current: Step }) {
    const index = ORDER.indexOf(current)
    return (
        <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
            {ORDER.map((step, i) => (
                <li key={step} className="flex items-center gap-2">
                    <span
                        className={cn(
                            'flex items-center gap-1.5',
                            i === index ? 'font-semibold text-ink' : 'text-ink-soft',
                        )}
                        aria-current={i === index ? 'step' : undefined}
                    >
                        <span className="mono">{i + 1}</span>
                        {STEP_LABEL[step]}
                    </span>
                    {i < ORDER.length - 1 && (
                        <span className="text-ink-soft" aria-hidden>
                            ›
                        </span>
                    )}
                </li>
            ))}
        </ol>
    )
}

/**
 * The SR number, given once, prominently.
 *
 * This is the only moment the person is handed the thing that lets them come
 * back, so it is the largest text on the screen and it is monospaced — it will
 * be copied down by hand or read down a phone, and in a proportional face that
 * is where 1, l and I become the same character.
 */
function Receipt({ request }: { request: ServiceRequest }) {
    return (
        <Panel>
            <PanelHeader>
                <PanelTitle>Request filed</PanelTitle>
            </PanelHeader>
            <PanelBody className="flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <span className="label-cap">Your SR number</span>
                    <SrNumber value={request.srNumber} className="text-3xl font-semibold text-ink" />
                </div>

                <p className="prose-measure text-base text-ink-mid">
                    Keep this number. It is the only thing needed to check on the request — no
                    account, no password. {request.type?.name}, handled by {request.agency?.name}.
                </p>

                <InfoNotice>
                    This record lives inside an academic replica of NYC 311. It has not been sent to
                    the City of New York.
                </InfoNotice>

                <div className="flex flex-wrap gap-2">
                    <Button asChild>
                        <Link href={`/sr/${encodeURIComponent(request.srNumber)}`}>
                            View its status
                        </Link>
                    </Button>
                    <Button asChild variant="outline">
                        <Link href="/file">File another</Link>
                    </Button>
                </div>
            </PanelBody>
        </Panel>
    )
}

function parseCoordinates(lat: string, lon: string): { lat: number; lon: number } | null {
    if (!lat.trim() || !lon.trim()) return null
    const parsedLat = Number(lat)
    const parsedLon = Number(lon)
    if (!Number.isFinite(parsedLat) || !Number.isFinite(parsedLon)) return null
    return { lat: parsedLat, lon: parsedLon }
}
