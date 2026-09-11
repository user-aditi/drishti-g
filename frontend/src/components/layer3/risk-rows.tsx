'use client'

import { Fragment, useState } from 'react'
import { Td, Tr } from '@/components/shared/register'
import { Badge } from '@/components/ui/badge'
import type { RiskFactor, RiskRow } from '@/types/layer3'

const pct = (v: number) => `${Math.round(v * 100)}%`

function rawValue(factor: RiskFactor): string {
    if (factor.factor === 'openComplaintLoad') return Math.round(factor.raw).toLocaleString('en-US')
    if (factor.factor === 'avgResolutionDays') return `${factor.raw.toFixed(1)} d`
    return pct(factor.raw)
}

export const RISK_COLUMNS = 9

/**
 * The register's rows, each opening onto its explanation.
 *
 * The explanation is a second row rather than a popover so it prints, reads in
 * order for a screen reader, and sits under the numbers it explains. Every
 * factor is listed — including the four held at the tuning floor, whose
 * contribution is small and shown as small rather than hidden.
 */
export function RiskRows({ rows }: { rows: RiskRow[] }) {
    const [open, setOpen] = useState<number | null>(null)

    return (
        <>
            {rows.map((row) => {
                const expanded = open === row.id
                return (
                    <Fragment key={row.id}>
                        <Tr>
                            <Td mono align="right">
                                {row.rank} / {row.of}
                            </Td>
                            <Td mono>{row.agency.code}</Td>
                            <Td>
                                {row.board.name} <span className="mono text-sm text-ink-soft">{row.board.code}</span>
                            </Td>
                            <Td mono align="right">
                                {row.requests.toLocaleString('en-US')}
                            </Td>
                            <Td mono align="right">
                                <strong className="text-ink">{pct(row.probability)}</strong>
                            </Td>
                            <Td mono align="right" className="text-ink-soft">
                                {row.score.toFixed(1)}
                            </Td>
                            <Td className="max-w-80 text-sm">{row.factors[0]?.explanation}</Td>
                            <Td className="whitespace-nowrap text-sm">
                                {row.outcome === null ? (
                                    <span className="text-ink-soft">Not on record</span>
                                ) : (
                                    <span className="inline-flex items-center gap-2">
                                        <span className="mono">{pct(row.nextBreachRate ?? 0)}</span>
                                        {row.outcome ? (
                                            <Badge tone="stop">Worst fifth</Badge>
                                        ) : (
                                            <Badge tone="done">Not worst fifth</Badge>
                                        )}
                                    </span>
                                )}
                            </Td>
                            <Td>
                                <span className="inline-flex items-center gap-2">
                                    {row.needsReview && <Badge tone="new">Review</Badge>}
                                    <button
                                        type="button"
                                        className="text-sm text-brand underline underline-offset-2"
                                        aria-expanded={expanded}
                                        onClick={() => setOpen(expanded ? null : row.id)}
                                    >
                                        {expanded ? 'Hide' : 'Why'}
                                    </button>
                                </span>
                            </Td>
                        </Tr>
                        {expanded && (
                            <tr className="bg-sunk">
                                <td colSpan={RISK_COLUMNS} className="px-4 py-3">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="text-left text-ink-soft">
                                                <th className="py-1 pr-4 font-medium">Factor</th>
                                                <th className="py-1 pr-4 text-right font-medium">Value</th>
                                                <th className="py-1 pr-4 text-right font-medium">On 0–100</th>
                                                <th className="py-1 pr-4 text-right font-medium">Weight</th>
                                                <th className="py-1 pr-4 text-right font-medium">Adds</th>
                                                <th className="py-1 font-medium">Reading</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {row.factors.map((factor) => (
                                                <tr key={factor.factor} className="border-t border-line">
                                                    <td className="py-1 pr-4 text-ink">{factor.label}</td>
                                                    <td className="mono py-1 pr-4 text-right">{rawValue(factor)}</td>
                                                    <td className="mono py-1 pr-4 text-right">
                                                        {factor.normalised.toFixed(1)}
                                                    </td>
                                                    <td className="mono py-1 pr-4 text-right">
                                                        {factor.weight.toFixed(2)}
                                                    </td>
                                                    <td className="mono py-1 pr-4 text-right">
                                                        {factor.contribution.toFixed(1)}
                                                    </td>
                                                    <td className="py-1 text-ink-mid">{factor.explanation}</td>
                                                </tr>
                                            ))}
                                            <tr className="border-t border-line-strong">
                                                <td className="py-1 pr-4 text-ink" colSpan={4}>
                                                    Score, then calibrated
                                                </td>
                                                <td className="mono py-1 pr-4 text-right text-ink">
                                                    {row.score.toFixed(1)}
                                                </td>
                                                <td className="py-1 text-ink-mid">
                                                    {pct(row.probability)} chance of the worst fifth next month
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </td>
                            </tr>
                        )}
                    </Fragment>
                )
            })}
        </>
    )
}
