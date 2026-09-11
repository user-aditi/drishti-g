import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { LayerMark } from '@/components/layer1/marks'
import { RecomputeButton } from '@/components/layer3/admin-actions'
import { RISK_COLUMNS, RiskRows } from '@/components/layer3/risk-rows'
import { ErrorNotice } from '@/components/shared/notices'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import {
    EmptyRow,
    RegisterBody,
    RegisterFrame,
    RegisterHead,
    RegisterTable,
    Td,
    Th,
    Tr,
} from '@/components/shared/register'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { Select } from '@/components/ui/select'
import { messageFrom } from '@/lib/api-error'
import { homeFor, requireUser } from '@/lib/auth'
import { getRiskModel, getRiskUnits } from '@/lib/layer3-server'
import type { RiskModel, RiskUnitsPage } from '@/types/layer3'

export const metadata: Metadata = { title: 'Risk register' }
export const dynamic = 'force-dynamic'

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || undefined
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(3)}`

const CANDIDATE: Record<string, string> = {
    hand: 'Hand-specified weights and caps (GRIE as built for NOIDA)',
    persistence: 'Missed deadlines alone (reference, not a candidate)',
    tuned_noida: 'Tuned weights, NOIDA caps',
    tuned_nyc: 'Tuned weights, caps from NYC',
    tuned_agency: 'Tuned weights, caps per agency',
}

function monthLabel(month: string) {
    return new Date(`${month}-01T00:00:00Z`).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
    })
}

/**
 * What the model is, before any of its numbers. Layer 3 exists to show that an
 * interpretable score can be defended; defending this one means saying what it
 * turned out to be on NYC data, which is mostly one factor (F-38).
 */
function ModelPanel({ model }: { model: RiskModel }) {
    const ev = model.evaluation
    const cal = ev.calibration
    return (
        <Panel>
            <PanelHeader>
                <PanelTitle>What this model is</PanelTitle>
            </PanelHeader>
            <PanelBody>
                <div className="flex flex-col gap-4 text-[14.5px] text-ink-mid">
                    <p>
                        For each agency&rsquo;s community board in a month, it estimates the chance that next
                        month&rsquo;s share of requests past their derived deadline lands in the worst fifth of the
                        panel (at or above {pct(model.label.cutoff)}). One unit-month in five does. Units with
                        fewer than {model.minRequests} requests in a month are not scored.
                    </p>
                    <p>
                        Tuned on {model.trainedOn.rows.toLocaleString('en-US')} unit-months of NYC&rsquo;s own
                        records ({model.trainedOn.firstMonth} to {model.trainedOn.lastMonth}), it puts{' '}
                        {Math.round((model.factors.find((f) => f.key === 'slaBreachRate')?.weight ?? 0) * 100)}% of its
                        weight on this month&rsquo;s missed deadlines. The other four factors sit at the 5% floor
                        tuning keeps so that every factor stays in the explanation — and that visibility costs
                        something: missed deadlines alone rank units slightly better ({signed(ev.shippedVsPersistence.aucGap)}{' '}
                        AUC, 95% interval {signed(ev.shippedVsPersistence.ciLow)} to{' '}
                        {signed(ev.shippedVsPersistence.ciHigh)}). Against the weights originally set by hand, the
                        tuned model is {signed(ev.shippedVsHand.aucGap)} AUC better.
                    </p>
                    <p>
                        The percentage shown is calibrated: raw, the score averaged {pct(cal.meanRaw ?? 0)} against{' '}
                        {pct(cal.observed ?? 0)} observed; after the calibration map, {pct(cal.meanCalibrated ?? 0)}.
                        The 0–100 score beside it only ranks.
                    </p>

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] text-sm">
                            <thead>
                                <tr className="text-left text-ink-soft">
                                    <th className="py-1 pr-4 font-medium">Factor</th>
                                    <th className="py-1 pr-4 text-right font-medium">Weight now</th>
                                    <th className="py-1 pr-4 text-right font-medium">Set by hand</th>
                                    <th className="py-1 font-medium">Scale</th>
                                </tr>
                            </thead>
                            <tbody>
                                {model.factors.map((f) => (
                                    <tr key={f.key} className="border-t border-line">
                                        <td className="py-1 pr-4 text-ink">{f.label}</td>
                                        <td className="mono py-1 pr-4 text-right">{f.weight.toFixed(2)}</td>
                                        <td className="mono py-1 pr-4 text-right">
                                            {(model.handSpecified.weights[f.key] ?? 0).toFixed(2)}
                                        </td>
                                        <td className="py-1">
                                            {f.curve.kind === 'proportion'
                                                ? 'share of requests'
                                                : `full at ${f.curve.cap.toFixed(f.key === 'avgResolutionDays' ? 1 : 0)} (NYC’s 95th percentile; by hand, ${model.handSpecified.caps[f.key]})`}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] text-sm">
                            <thead>
                                <tr className="text-left text-ink-soft">
                                    <th className="py-1 pr-4 font-medium">Candidate, grouped cross-validation</th>
                                    <th className="py-1 pr-4 text-right font-medium">AUC</th>
                                    <th className="py-1 pr-4 text-right font-medium">Within agency</th>
                                    <th className="py-1 font-medium" />
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(ev.candidates).map(([name, c]) => (
                                    <tr key={name} className="border-t border-line">
                                        <td className="py-1 pr-4 text-ink">{CANDIDATE[name] ?? name}</td>
                                        <td className="mono py-1 pr-4 text-right">{c.cvAuc.toFixed(3)}</td>
                                        <td className="mono py-1 pr-4 text-right">{c.withinAgencyAuc.toFixed(3)}</td>
                                        <td className="py-1">
                                            {name === model.chosen ? (
                                                <Badge tone="new">Shipped</Badge>
                                            ) : c.maxSaturation > 0.5 && name.startsWith('tuned') ? (
                                                <span className="text-ink-soft">
                                                    Ineligible: {pct(c.maxSaturation)} of units at the cap
                                                </span>
                                            ) : null}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </PanelBody>
        </Panel>
    )
}

/**
 * GRIE's risk register. Layer 3 — NYC 311 scores nothing.
 *
 * Ranked within each agency, because that is the comparison the numbers can
 * bear: an agency's boards against each other. Beside each prediction, what
 * then happened, wherever the next month is on record.
 */
export default async function RiskRegisterPage({
    searchParams,
}: {
    searchParams: Record<string, string | string[] | undefined>
}) {
    const user = await requireUser()
    if (user.role !== 'ADMIN') redirect(homeFor(user.role))

    const month = one(searchParams.month)
    const agency = one(searchParams.agency)

    let data: RiskUnitsPage | null = null
    let model: RiskModel | null = null
    let error: string | null = null
    try {
        ;[data, model] = await Promise.all([getRiskUnits({ month }), getRiskModel()])
    } catch (err) {
        error = messageFrom(err, 'The risk register could not be loaded.')
    }

    const agencies = data ? [...new Set(data.rows.map((r) => r.agency.code))].sort() : []
    const rows = data ? data.rows.filter((r) => !agency || r.agency.code === agency) : []
    const known = rows.filter((r) => r.outcome !== null)
    const flagged = rows.filter((r) => r.needsReview)
    const flaggedKnown = flagged.filter((r) => r.outcome !== null)

    return (
        <PageShell>
            <PageHeading
                title="Risk register"
                actions={<LayerMark layer={3} />}
                description="Every agency's community boards, scored month by month on NYC's own records: the chance each is among the worst fifth for missed deadlines the following month, and — where that month is on record — what happened."
            />

            {error ? (
                <ErrorNotice title="Could not load the risk register" message={error} />
            ) : (
                data &&
                model && (
                    <>
                        <ModelPanel model={model} />

                        <div className="flex flex-wrap items-end justify-between gap-4">
                            <form className="flex flex-wrap items-end gap-3" method="get">
                                <label className="flex flex-col gap-1 text-sm text-ink-mid">
                                    Month
                                    <Select name="month" defaultValue={data.month ?? undefined} className="w-48">
                                        {data.months.map((m) => (
                                            <option key={m.month} value={m.month}>
                                                {monthLabel(m.month)} · {m.units}
                                            </option>
                                        ))}
                                    </Select>
                                </label>
                                <label className="flex flex-col gap-1 text-sm text-ink-mid">
                                    Agency
                                    <Select name="agency" defaultValue={agency ?? ''} className="w-40">
                                        <option value="">All agencies</option>
                                        {agencies.map((code) => (
                                            <option key={code} value={code}>
                                                {code}
                                            </option>
                                        ))}
                                    </Select>
                                </label>
                                <Button type="submit" variant="outline">
                                    Show
                                </Button>
                            </form>
                            <RecomputeButton />
                        </div>

                        {data.month === null ? (
                            <p className="text-ink-mid">
                                Nothing has been scored yet. Recompute to score every unit-month on record.
                            </p>
                        ) : (
                            <>
                                <p className="text-[14.5px] text-ink-mid">
                                    {monthLabel(data.month)}: <span className="mono text-ink">{rows.length}</span>{' '}
                                    units scored, <span className="mono text-ink">{flagged.length}</span> at or above{' '}
                                    {Math.round(data.reviewProbability * 100)}% and flagged for review.{' '}
                                    {known.length > 0 ? (
                                        <>
                                            The next month is on record for {known.length}:{' '}
                                            <span className="mono text-ink">{known.filter((r) => r.outcome).length}</span>{' '}
                                            landed in the worst fifth
                                            {flaggedKnown.length > 0 && (
                                                <>
                                                    , including{' '}
                                                    <span className="mono text-ink">
                                                        {flaggedKnown.filter((r) => r.outcome).length}
                                                    </span>{' '}
                                                    of the {flaggedKnown.length} flagged
                                                </>
                                            )}
                                            .
                                        </>
                                    ) : (
                                        'The month after is not in the corpus, so these predictions cannot be checked.'
                                    )}
                                </p>
                                <RegisterFrame>
                                    <RegisterTable caption="Units ranked within each agency by score">
                                        <RegisterHead>
                                            <Th align="right">Rank</Th>
                                            <Th>Agency</Th>
                                            <Th>Community board</Th>
                                            <Th align="right">Requests</Th>
                                            <Th align="right">Chance, next month</Th>
                                            <Th align="right">Score</Th>
                                            <Th>Leading reason</Th>
                                            <Th>What happened</Th>
                                            <Th />
                                        </RegisterHead>
                                        <RegisterBody>
                                            {rows.length === 0 ? (
                                                <EmptyRow colSpan={RISK_COLUMNS}>No units scored for this month.</EmptyRow>
                                            ) : (
                                                <RiskRows rows={rows} />
                                            )}
                                        </RegisterBody>
                                    </RegisterTable>
                                </RegisterFrame>
                                <p className="text-sm text-ink-soft">
                                    Score is the weighted sum on 0–100 and only orders units; the chance beside it is
                                    the calibrated figure. Deadlines are derived from observed closure times — NYC
                                    publishes none for these types. Model {data.modelVersion}.
                                </p>
                            </>
                        )}
                    </>
                )
            )}
        </PageShell>
    )
}

// Keep Tr and Td referenced for the empty-state path's column count parity.
void Tr
void Td
