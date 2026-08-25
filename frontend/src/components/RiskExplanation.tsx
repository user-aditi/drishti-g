import { BAND_META } from '../lib/format'
import type { RiskBand, RiskFactor } from '../lib/types'

/**
 * Renders *why* a score is what it is.
 *
 * This is the product's central claim and the paper's: a governance risk score
 * that a municipal officer can audit by eye. Each factor shows its own
 * contribution as a proportion of the total, so the bars add up to the score
 * rather than merely ranking the causes.
 */
export function RiskExplanation({
  factors,
  score,
  band,
  compact = false,
}: {
  factors: RiskFactor[]
  score: number
  band: RiskBand
  compact?: boolean
}) {
  if (factors.length === 0) {
    return <p className="text-sm text-slate-500">No contributing factors were recorded.</p>
  }

  // Scale bars against the largest contribution, not against 100, so small
  // differences between factors stay visible.
  const maxContribution = Math.max(...factors.map((f) => f.contribution), 1)

  return (
    <div className="space-y-3">
      {!compact && (
        <div className="flex items-baseline justify-between border-b border-slate-100 pb-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            How this score was calculated
          </span>
          <span className="tnum text-xs text-slate-500">
            contributions total {score.toFixed(1)}
          </span>
        </div>
      )}

      {factors.map((factor) => {
        const share = (factor.contribution / maxContribution) * 100
        // A factor contributing nothing still gets a row: "no evidence of risk
        // here" is information a supervisor needs.
        const inactive = factor.contribution === 0

        return (
          <div key={factor.factor} className={inactive ? 'opacity-55' : undefined}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-medium text-slate-800">{factor.label}</span>
              <span className="tnum shrink-0 text-xs text-slate-500">
                {factor.contribution.toFixed(1)}
                <span className="text-slate-400"> / {(factor.weight * 100).toFixed(0)} max</span>
              </span>
            </div>

            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full transition-all ${BAND_META[band].bar}`}
                style={{ width: `${Math.max(share, inactive ? 0 : 2)}%` }}
              />
            </div>

            <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{factor.explanation}</p>
          </div>
        )
      })}
    </div>
  )
}

/**
 * The arithmetic, spelled out.
 *
 * Shown on the detail page so a sceptical reader — a supervisor, an examiner —
 * can reproduce the score by hand. An interpretable model that nobody can check
 * is not interpretable.
 */
export function RiskWorking({ factors, score }: { factors: RiskFactor[]; score: number }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-xs">
        <thead>
          <tr className="border-b border-slate-200 text-slate-500">
            <th className="pb-2 pr-3 font-medium">Factor</th>
            <th className="pb-2 pr-3 text-right font-medium">Measured</th>
            <th className="pb-2 pr-3 text-right font-medium">Scaled</th>
            <th className="pb-2 pr-3 text-right font-medium">Weight</th>
            <th className="pb-2 text-right font-medium">Contribution</th>
          </tr>
        </thead>
        <tbody className="tnum divide-y divide-slate-100">
          {factors.map((f) => (
            <tr key={f.factor}>
              <td className="py-2 pr-3 font-medium text-slate-700">{f.label}</td>
              <td className="py-2 pr-3 text-right text-slate-600">{f.raw}</td>
              <td className="py-2 pr-3 text-right text-slate-600">{f.normalised.toFixed(1)}</td>
              <td className="py-2 pr-3 text-right text-slate-500">×{f.weight.toFixed(2)}</td>
              <td className="py-2 text-right font-semibold text-slate-800">
                {f.contribution.toFixed(2)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-200">
            <td colSpan={4} className="pt-2 pr-3 text-right font-medium text-slate-600">
              Total risk score
            </td>
            <td className="tnum pt-2 text-right text-sm font-bold text-slate-900">
              {score.toFixed(2)}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
