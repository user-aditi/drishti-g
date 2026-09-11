'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { StaffName } from '@/components/layer1/marks'
import { ErrorNotice } from '@/components/shared/notices'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { messageFrom } from '@/lib/api-error'
import { normaliseSrNumber } from '@/lib/format'
import { layer1Client } from '@/lib/layer1-api'
import type { Layer1Detail, OfficerSummary } from '@/types/layer1'

/**
 * Who may be offered for a request: officers posted to its board, then the
 * borough duty officers.
 *
 * The API refuses anyone else, and offering them here would only let a
 * supervisor pick someone and be told no. Board officers come first because the
 * posting rule would have chosen one of them.
 */
function eligible(officers: OfficerSummary[], boardCode: string | null) {
    const onBoard = officers.filter((o) => boardCode !== null && o.units.some((u) => u.code === boardCode))
    const borough = officers.filter((o) => o.units.some((u) => !u.code.includes('-')))
    return [...onBoard, ...borough.filter((o) => !onBoard.includes(o))]
}

export function AssignControl({
    requestId,
    boardCode,
    officers,
    currentOfficerId = null,
    onDone,
}: {
    requestId: number
    boardCode: string | null
    officers: OfficerSummary[]
    currentOfficerId?: number | null
    onDone?: () => void
}) {
    const router = useRouter()
    const [pending, startTransition] = useTransition()
    const options = useMemo(() => eligible(officers, boardCode), [officers, boardCode])
    const [officerId, setOfficerId] = useState<string>(
        String(options.find((o) => o.id !== currentOfficerId)?.id ?? ''),
    )
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function submit(event: React.FormEvent) {
        event.preventDefault()
        if (!officerId) return
        setError(null)
        setBusy(true)
        try {
            await layer1Client.assign(requestId, Number(officerId))
            onDone?.()
            startTransition(() => router.refresh())
        } catch (err) {
            setError(messageFrom(err, 'The request could not be assigned.'))
        } finally {
            setBusy(false)
        }
    }

    if (options.length === 0) {
        return <span className="text-sm text-stop">Nobody is posted to this board or the borough.</span>
    }

    return (
        <form onSubmit={submit} className="flex flex-wrap items-center gap-2">
            <Select
                aria-label="Officer"
                value={officerId}
                disabled={busy || pending}
                onChange={(event) => setOfficerId(event.target.value)}
            >
                {options.map((o) => (
                    <option key={o.id} value={o.id} disabled={o.id === currentOfficerId}>
                        {o.name} — holds {o.openLoad}
                        {o.id === currentOfficerId ? ' (current)' : ''}
                    </option>
                ))}
            </Select>
            <Button type="submit" size="sm" disabled={busy || pending || !officerId}>
                {busy ? 'Assigning…' : 'Assign'}
            </Button>
            {error && <span className="text-sm text-stop">{error}</span>}
        </form>
    )
}

/**
 * Reassigning something that already has an owner.
 *
 * The unassigned register is empty in the steady state, so without this the
 * screen could only ever assign, never move work between people — which is most
 * of what supervising a desk actually is.
 */
export function ReassignBySr({ officers }: { officers: OfficerSummary[] }) {
    const [input, setInput] = useState('')
    const [found, setFound] = useState<Layer1Detail | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function lookup(event: React.FormEvent) {
        event.preventDefault()
        setError(null)
        setFound(null)
        setBusy(true)
        try {
            setFound(await layer1Client.officerRequest(normaliseSrNumber(input)))
        } catch (err) {
            setError(messageFrom(err, 'No request in your agency has that number.'))
        } finally {
            setBusy(false)
        }
    }

    return (
        <div className="flex flex-col gap-3 rounded-[var(--radius)] border border-line bg-surface px-4 py-3">
            <form onSubmit={lookup} className="flex flex-wrap items-end gap-2">
                <div>
                    <Label htmlFor="reassign-sr">SR number</Label>
                    <Input
                        id="reassign-sr"
                        className="mono"
                        value={input}
                        placeholder="NYC-59489502"
                        onChange={(event) => setInput(event.target.value)}
                    />
                </div>
                <Button type="submit" variant="outline" disabled={busy || input.trim() === ''}>
                    {busy ? 'Finding…' : 'Find'}
                </Button>
            </form>
            {error && <ErrorNotice title="Not found" message={error} />}
            {found && (
                <div className="flex flex-col gap-2">
                    <span className="text-sm text-ink-mid">
                        <span className="mono text-ink">{found.srNumber}</span> · {found.type?.name} ·{' '}
                        {found.orgUnit?.code ?? 'no board'} — held by{' '}
                        {found.accountable ? (
                            <StaffName name={found.accountable.name} isSynthetic={found.accountable.isSynthetic} />
                        ) : (
                            'nobody'
                        )}
                    </span>
                    {found.status === 'CLOSED' ? (
                        <span className="text-sm text-ink-soft">Closed — there is nothing left to answer for.</span>
                    ) : (
                        <AssignControl
                            requestId={found.id}
                            boardCode={found.orgUnit?.code ?? null}
                            officers={officers}
                            currentOfficerId={found.accountable?.id ?? null}
                            onDone={() => setFound(null)}
                        />
                    )}
                </div>
            )}
        </div>
    )
}
