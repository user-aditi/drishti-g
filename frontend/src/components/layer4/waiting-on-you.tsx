import Link from 'next/link'
import { LayerMark } from '@/components/layer1/marks'
import { SrNumber } from '@/components/shared/request-bits'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { getWaiting } from '@/lib/layer4-server'
import type { WaitingRow } from '@/types/layer4'

/**
 * The jobs a crew says are finished, on requests this resident reported. Layer 4.
 *
 * The resident's answer outranks every automated check, but until Phase 9 the
 * question was only ever shown on the request's own page, so a resident had to
 * happen to open the right one to be asked at all. This puts every open question
 * where they will look first, and renders nothing when there is none — an empty
 * panel here would only be noise on a page about their own requests.
 */
export async function WaitingOnYou() {
    let rows: WaitingRow[] = []
    try {
        rows = (await getWaiting()).rows
    } catch {
        // The resident's own register must still load without this.
        return null
    }
    if (rows.length === 0) return null

    return (
        <Panel>
            <PanelHeader>
                <PanelTitle>
                    <span className="inline-flex items-center gap-3">
                        Waiting on you <LayerMark layer={4} />
                    </span>
                </PanelTitle>
            </PanelHeader>
            <PanelBody>
                <div className="flex flex-col gap-3">
                    <p className="text-[14.5px] text-ink-mid">
                        A crew says {rows.length === 1 ? 'this job is' : 'these jobs are'} finished. You reported{' '}
                        {rows.length === 1 ? 'it' : 'them'}, so you are asked before anyone else: open each one,
                        look at what the crew sent, and say whether it matches what you can see.
                    </p>
                    <ul className="flex flex-col divide-y divide-line rounded-[var(--radius)] border border-line">
                        {rows.map((row) => (
                            <li key={row.workOrderId} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                                <Link
                                    href={`/sr/${encodeURIComponent(row.srNumber)}`}
                                    className="text-brand underline underline-offset-2"
                                >
                                    <SrNumber value={row.srNumber} />
                                </Link>
                                <span className="text-ink">{row.type}</span>
                                {row.address && <span className="text-sm text-ink-soft">{row.address}</span>}
                                {row.completedAt && (
                                    <span className="mono ml-auto text-sm text-ink-soft">
                                        reported done {formatDateTime(row.completedAt)}
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            </PanelBody>
        </Panel>
    )
}
