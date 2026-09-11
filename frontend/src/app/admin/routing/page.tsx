import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LayerMark } from '@/components/layer1/marks'
import { ErrorNotice } from '@/components/shared/notices'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import {
    RegisterBody,
    RegisterFrame,
    RegisterHead,
    RegisterTable,
    Td,
    Th,
    Tr,
} from '@/components/shared/register'
import { Badge } from '@/components/ui/badge'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { messageFrom } from '@/lib/api-error'
import { homeFor, requireUser } from '@/lib/auth'
import { getRoutingReport } from '@/lib/layer3-server'
import type { RoutingReport } from '@/types/layer3'

export const metadata: Metadata = { title: 'Routing' }
export const dynamic = 'force-dynamic'

const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const points = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(2)}`

const CANDIDATE: Record<string, string> = {
    modal: 'Always the type’s usual agency',
    descriptor: 'By descriptor',
    descriptor_location: 'By descriptor and location type',
    descriptor_channel: 'By descriptor and channel',
    full: 'By descriptor, location type, channel and board',
}

/**
 * GCCE's routing report. Layer 3 — a measurement, not a router.
 *
 * GCCE was to choose the agency for each request, measured against the agency
 * NYC assigned. The page reports what that measurement found, including the
 * part that removed the reason to run it (F-23), and the table it learned.
 */
export default async function RoutingPage() {
    const user = await requireUser()
    if (user.role !== 'ADMIN') redirect(homeFor(user.role))

    let report: RoutingReport | null = null
    let error: string | null = null
    try {
        report = await getRoutingReport()
    } catch (err) {
        error = messageFrom(err, 'The routing report could not be loaded.')
    }

    return (
        <PageShell>
            <PageHeading
                title="Routing"
                actions={<LayerMark layer={3} />}
                description="Whether a model can choose the right agency for a request better than NYC's own taxonomy already does — measured on NYC's assignments, and reported rather than run."
            />
            {error ? (
                <ErrorNotice title="Could not load the routing report" message={error} />
            ) : (
                report && (
                    <>
                        <Panel>
                            <PanelHeader>
                                <PanelTitle>What was found</PanelTitle>
                            </PanelHeader>
                            <PanelBody>
                                <div className="flex flex-col gap-3 text-[14.5px] text-ink-mid">
                                    <p>
                                        NYC&rsquo;s complaint types are defined per agency, so choosing the type
                                        chooses the agency. Of the {report.scope.brooklynTypes2024} complaint types
                                        filed in Brooklyn in 2024, {report.scope.brooklynTypes2024 - report.scope.sharedTypes2024}{' '}
                                        went to a single agency. The {report.scope.sharedTypes2024} that did not —{' '}
                                        {report.scope.typesMeasured.join(', ')} — carried{' '}
                                        {pct(report.scope.sharedShareOfRequests2024)} of requests, and are all there is
                                        to route.
                                    </p>
                                    <p>
                                        On those four, chosen on 2024 and tested once on {report.evaluation.testYear}, a
                                        lookup table beats always choosing the usual agency by{' '}
                                        <span className="mono text-ink">
                                            {points(report.evaluation.gainOverModal.gain)}
                                        </span>{' '}
                                        points (95% interval {points(report.evaluation.gainOverModal.ciLow)} to{' '}
                                        {points(report.evaluation.gainOverModal.ciHigh)}), which clears the gate the
                                        plan set. All of it comes from Asbestos and Graffiti, where NYC&rsquo;s own
                                        descriptor names the agency. On Encampment and Highway Condition — the two where
                                        the agency is genuinely uncertain — nothing known at intake does better than the
                                        usual agency.
                                    </p>
                                    <p>
                                        So these four types were not imported and nothing here routes live: running the
                                        table would reproduce NYC&rsquo;s menu, not improve on it (decided 11 September
                                        2026).
                                    </p>
                                </div>
                            </PanelBody>
                        </Panel>

                        <RegisterFrame>
                            <RegisterTable caption={`Accuracy by type, ${report.evaluation.testYear}`}>
                                <RegisterHead>
                                    <Th>Complaint type</Th>
                                    <Th align="right">Requests</Th>
                                    <Th align="right">Usual agency right</Th>
                                    <Th align="right">Table right</Th>
                                </RegisterHead>
                                <RegisterBody>
                                    {Object.entries(report.evaluation.perType).map(([type, v]) => (
                                        <Tr key={type}>
                                            <Td>{type}</Td>
                                            <Td mono align="right">
                                                {v.rows.toLocaleString('en-US')}
                                            </Td>
                                            <Td mono align="right">
                                                {pct(v.modal)}
                                            </Td>
                                            <Td mono align="right">
                                                {pct(v.chosen)}
                                            </Td>
                                        </Tr>
                                    ))}
                                </RegisterBody>
                            </RegisterTable>
                        </RegisterFrame>

                        <RegisterFrame>
                            <RegisterTable caption="Candidates: chosen on 2024, reported on 2025">
                                <RegisterHead>
                                    <Th>Candidate</Th>
                                    <Th align="right">2024 (to choose)</Th>
                                    <Th align="right">2025 (to report)</Th>
                                    <Th />
                                </RegisterHead>
                                <RegisterBody>
                                    {Object.keys(report.evaluation.accuracy).map((name) => (
                                        <Tr key={name}>
                                            <Td>{CANDIDATE[name] ?? name}</Td>
                                            <Td mono align="right">
                                                {pct(report!.evaluation.validation[name] ?? 0)}
                                            </Td>
                                            <Td mono align="right">
                                                {pct(report!.evaluation.accuracy[name] ?? 0)}
                                            </Td>
                                            <Td>{name === report!.chosen && <Badge tone="new">Chosen</Badge>}</Td>
                                        </Tr>
                                    ))}
                                </RegisterBody>
                            </RegisterTable>
                        </RegisterFrame>

                        <RegisterFrame>
                            <RegisterTable
                                caption={`The learned table (${report.modelVersion}): each cell needs ${report.minSupport} earlier requests; otherwise the type's usual agency`}
                            >
                                <RegisterHead>
                                    <Th>Complaint type</Th>
                                    <Th>Descriptor</Th>
                                    <Th>Agency</Th>
                                    <Th align="right">Earlier requests</Th>
                                    <Th align="right">Share</Th>
                                </RegisterHead>
                                <RegisterBody>
                                    {report.cells.map((cell, i) => (
                                        <Tr key={i}>
                                            <Td>{cell.type}</Td>
                                            <Td className="text-sm">
                                                {cell.values.length === 0 ? (
                                                    <span className="text-ink-soft">any (usual agency)</span>
                                                ) : (
                                                    cell.values.join(' · ') || '—'
                                                )}
                                            </Td>
                                            <Td mono>{cell.agency}</Td>
                                            <Td mono align="right">
                                                {cell.support.toLocaleString('en-US')}
                                            </Td>
                                            <Td mono align="right">
                                                {pct(cell.share)}
                                            </Td>
                                        </Tr>
                                    ))}
                                </RegisterBody>
                            </RegisterTable>
                        </RegisterFrame>
                    </>
                )
            )}
        </PageShell>
    )
}
