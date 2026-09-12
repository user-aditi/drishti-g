import { Badge } from '@/components/ui/badge'
import type { ProofOutcome, ProofView } from '@/types/layer4'

/**
 * What the checks found, in the words the person reading it needs.
 *
 * Each check says what it could and could not establish, because half of them
 * routinely cannot run: most phones strip the capture time and location from a
 * photograph, and that is ordinary rather than suspicious. A check that could
 * not run is shown as exactly that, never as a failure.
 */

const OUTCOME: Record<ProofOutcome, { tone: 'stop' | 'wait' | 'done' | 'new'; label: string }> = {
    REJECTED: { tone: 'stop', label: 'Not accepted as proof' },
    NEEDS_CITIZEN: { tone: 'wait', label: 'With the resident who reported it' },
    NEEDS_OFFICER: { tone: 'wait', label: 'Needs an officer' },
    CONFIRMED: { tone: 'done', label: 'Confirmed' },
}

export function ProofOutcomeBadge({ outcome }: { outcome: ProofOutcome }) {
    const { tone, label } = OUTCOME[outcome]
    return <Badge tone={tone}>{label}</Badge>
}

export function ProofChecks({ proof, compact = false }: { proof: ProofView; compact?: boolean }) {
    return (
        <div className="flex flex-col gap-2">
            {!compact && (
                <div className="flex flex-wrap items-center gap-3">
                    <ProofOutcomeBadge outcome={proof.outcome} />
                    <span className="text-sm text-ink-soft">
                        {proof.score.toFixed(0)} of 100 across the checks below — evidence about the
                        photograph, not proof that the work was done.
                    </span>
                </div>
            )}
            <ul className="flex flex-col divide-y divide-line rounded-[var(--radius)] border border-line">
                {proof.checks.map((check) => {
                    const inconclusive = !check.passed && check.contribution > 0
                    return (
                        <li key={check.check} className="flex items-start gap-3 px-3 py-2">
                            <span
                                aria-hidden
                                className={
                                    check.passed
                                        ? 'mt-0.5 text-done'
                                        : inconclusive
                                          ? 'mt-0.5 text-ink-soft'
                                          : 'mt-0.5 text-stop'
                                }
                            >
                                {check.passed ? '✓' : inconclusive ? '–' : '✗'}
                            </span>
                            <span className="flex flex-col">
                                <span className="text-sm text-ink">{check.label}</span>
                                <span className="text-sm text-ink-mid">{check.detail}</span>
                            </span>
                            <span className="mono ml-auto whitespace-nowrap text-sm text-ink-soft">
                                {check.contribution} / {check.weight}
                            </span>
                        </li>
                    )
                })}
            </ul>
        </div>
    )
}
