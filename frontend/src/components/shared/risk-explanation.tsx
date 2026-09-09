import { BAND_META } from '@/lib/constants'
import { cn } from '@/lib/utils'
import type { RiskBand, RiskFactor } from '@/types'

/**
 * Renders *why* a score is what it is.
 *
 * This is the product's central claim and the paper's: a governance risk score
 * a municipal officer can audit by eye. Each factor shows its own contribution,
 * so the bars account for the score rather than merely ranking the causes.
 */
export function RiskExplanation({
    factors,
    score,
    band,
    showTotal = false,
}: {
    factors: RiskFactor[]
    score: number
    band: RiskBand
    showTotal?: boolean
}) {
    if (factors.length === 0) {
        return (
            <p className="text-sm text-[color:var(--muted-foreground)]">
                No contributing factors were recorded.
            </p>
        )
    }

    // Scale bars against the largest contribution, not against 100, so small
    // differences between factors stay visible.
    const maxContribution = Math.max(...factors.map((f) => f.contribution), 1)

    return (
        <div className="space-y-3">
            {showTotal && (
                <div className="flex items-baseline justify-between border-b border-[color:var(--border)] pb-2">
                    <span className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                        How this score was calculated
                    </span>
                    <span className="tnum text-xs text-[color:var(--muted-foreground)]">
                        contributions total {score.toFixed(1)}
                    </span>
                </div>
            )}

            {factors.map((factor) => {
                const share = (factor.contribution / maxContribution) * 100
                // A factor contributing nothing still gets a row: "no evidence of
                // risk here" is information a supervisor needs.
                const inactive = factor.contribution === 0

                return (
                    <div key={factor.factor} className={inactive ? 'opacity-55' : undefined}>
                        <div className="flex items-baseline justify-between gap-3">
                            <span className="text-sm font-medium">{factor.label}</span>
                            <span className="tnum shrink-0 text-xs text-[color:var(--muted-foreground)]">
                                {factor.contribution.toFixed(1)}
                                <span className="opacity-60"> / {(factor.weight * 100).toFixed(0)} max</span>
                            </span>
                        </div>

                        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color:var(--muted)]">
                            <div
                                className={cn('h-full rounded-full transition-all', BAND_META[band].bar)}
                                style={{ width: `${Math.max(share, inactive ? 0 : 2)}%` }}
                            />
                        </div>

                        <p className="mt-1.5 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                            {factor.explanation}
                        </p>
                    </div>
                )
            })}
        </div>
    )
}

/**
 * The arithmetic, spelled out.
 *
 * So a sceptical reader — a supervisor, an examiner — can reproduce the score by
 * hand. An interpretable model nobody can check is not interpretable.
 */
export function RiskWorking({ factors, score }: { factors: RiskFactor[]; score: number }) {
    return (
        <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-xs">
                <thead>
                    <tr className="border-b border-[color:var(--border)] text-[color:var(--muted-foreground)]">
                        <th className="pb-2 pr-3 font-medium">Factor</th>
                        <th className="pb-2 pr-3 text-right font-medium">Measured</th>
                        <th className="pb-2 pr-3 text-right font-medium">Scaled</th>
                        <th className="pb-2 pr-3 text-right font-medium">Weight</th>
                        <th className="pb-2 text-right font-medium">Contribution</th>
                    </tr>
                </thead>
                <tbody className="tnum divide-y divide-[color:var(--border)]">
                    {factors.map((f) => (
                        <tr key={f.factor}>
                            <td className="py-2 pr-3 font-medium">{f.label}</td>
                            <td className="py-2 pr-3 text-right text-[color:var(--muted-foreground)]">{f.raw}</td>
                            <td className="py-2 pr-3 text-right text-[color:var(--muted-foreground)]">
                                {f.normalised.toFixed(1)}
                            </td>
                            <td className="py-2 pr-3 text-right text-[color:var(--muted-foreground)]">
                                ×{f.weight.toFixed(2)}
                            </td>
                            <td className="py-2 text-right font-semibold">{f.contribution.toFixed(2)}</td>
                        </tr>
                    ))}
                </tbody>
                <tfoot>
                    <tr className="border-t-2 border-[color:var(--border)]">
                        <td colSpan={4} className="pt-2 pr-3 text-right font-medium text-[color:var(--muted-foreground)]">
                            Total risk score
                        </td>
                        <td className="tnum pt-2 text-right text-sm font-bold">{score.toFixed(2)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    )
}

/**
 * A 0-100 risk score as a filled arc.
 *
 * Deliberately not a plain number: the band colour and the fill carry severity
 * at a glance, and the number stays for anyone who needs the value.
 */
export function RiskDial({
    score,
    band,
    size = 96,
}: {
    score: number
    band: RiskBand
    size?: number
}) {
    const meta = BAND_META[band]
    const stroke = 8
    const radius = (size - stroke) / 2
    const circumference = 2 * Math.PI * radius
    const filled = (Math.min(100, Math.max(0, score)) / 100) * circumference

    return (
        <div className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    strokeWidth={stroke}
                    className="stroke-slate-200"
                />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={radius}
                    fill="none"
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${filled} ${circumference}`}
                    stroke={meta.hex}
                />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className={cn('tnum text-xl font-bold', meta.text)}>{Math.round(score)}</span>
                <span className="text-[10px] font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                    {meta.label}
                </span>
            </div>
        </div>
    )
}
