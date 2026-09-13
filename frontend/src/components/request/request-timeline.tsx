import { cn } from '@/lib/utils'
import { STATUS_META } from '@/lib/constants'
import { formatDateTime, relativeTime } from '@/lib/format'
import type { ProgressStep, RequestDetail } from '@/types'

/**
 * The life of a request, from what the record actually contains.
 *
 * The steps here come from the status history the API keeps, plus the one
 * derived entry — the deadline — drawn differently because it is a calculation
 * rather than something that happened.
 *
 * What is deliberately absent is the tempting part. An imported request has
 * exactly one history entry: its arrival in the state NYC last published. NYC
 * publishes no status history, so there is nothing to show between "filed" and
 * "closed", and inventing "assigned to a crew" or "inspection scheduled" would
 * be manufacturing a record of municipal work that nobody did. A short timeline
 * is the honest one.
 *
 * What does appear between them, for a request this system has acted on, is what
 * this project's layers actually did — an officer answering for it, a crew sent,
 * an escalation — passed in as `layerSteps` and described by role, never by name.
 * Those are real events in this system, not reconstructions of New York's.
 */
export function RequestTimeline({
    request,
    now,
    layerSteps = [],
}: {
    request: RequestDetail
    /** The system reference date in epoch ms — see ReferenceDate. */
    now: number
    /** What later layers did, from the progress endpoint. Filing and closing come from the history instead. */
    layerSteps?: ProgressStep[]
}) {
    const stillOpen = request.status !== 'CLOSED'
    const overdue = request.isOverdue && stillOpen

    // The deadline is folded into the recorded events in time order rather than
    // pinned to the end, so a reader can see where it fell relative to the work.
    const steps: Step[] = request.history.map((entry, index) => ({
        key: `h${entry.id}`,
        at: entry.at,
        tone: entry.toStatus === 'CLOSED' ? 'done' : index === 0 ? 'done' : 'wait',
        title:
            index === 0 && entry.fromStatus === null
                ? 'Filed'
                : `${STATUS_META[entry.toStatus].label}`,
        detail:
            index === 0 && entry.fromStatus === null
                ? request.isImported
                    ? 'Recorded by NYC 311 and published in the open dataset. The City publishes no history of what happened next.'
                    : 'Filed through this replica. Not transmitted to the City of New York.'
                : entry.note ??
                  (entry.fromStatus
                      ? `Moved from ${STATUS_META[entry.fromStatus].label.toLowerCase()}.`
                      : 'Status recorded.'),
    }))

    for (const step of layerSteps) {
        if (step.key === 'filed' || step.key === 'closed') continue
        steps.push({ key: `l-${step.key}`, at: step.at, tone: 'done', title: step.label, detail: step.detail ?? '' })
    }

    if (request.slaDueAt) {
        steps.push({
            key: 'derived-deadline',
            at: request.slaDueAt,
            tone: overdue ? 'stop' : 'derived',
            title: overdue ? 'Passed its derived deadline' : 'Derived deadline',
            detail: (
                <>
                    Calculated by this project from observed closure times, not published by the
                    City<span aria-hidden> †</span>.
                </>
            ),
        })
    }

    // Only dated steps are ordered. The open-ended one is appended afterwards and
    // has no timestamp by design — it is the absence of an event, not an event.
    steps.sort((a, b) => (a.at ? Date.parse(a.at) : 0) - (b.at ? Date.parse(b.at) : 0))

    if (stillOpen) {
        steps.push({
            key: 'still-open',
            at: null,
            tone: 'wait',
            title: 'Still open',
            detail: `Last recorded status: ${STATUS_META[request.status].label.toLowerCase()}.`,
        })
    }

    return (
        <ol className="flex flex-col">
            {steps.map((step, index) => (
                <StepRow key={step.key} step={step} now={now} last={index === steps.length - 1} />
            ))}
        </ol>
    )
}

type StepTone = 'done' | 'wait' | 'stop' | 'derived'

interface Step {
    key: string
    at: string | null
    tone: StepTone
    title: string
    detail: React.ReactNode
}

const DOT: Record<StepTone, string> = {
    done: 'bg-done border-done',
    wait: 'bg-wait border-wait',
    stop: 'bg-stop border-stop',
    // Hollow, because it marks a calculation rather than something that happened.
    derived: 'bg-transparent border-line-strong',
}

function StepRow({ step, now, last }: { step: Step; now: number; last: boolean }) {
    return (
        <li className="flex gap-3">
            <div className="flex flex-col items-center pt-1">
                <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full border', DOT[step.tone])} />
                {!last && <span className="w-px flex-1 bg-line" />}
            </div>

            <div className={cn('flex flex-col gap-0.5', last ? 'pb-0' : 'pb-5')}>
                <p className="text-base font-medium text-ink">{step.title}</p>
                {step.at && (
                    <p className="mono text-sm text-ink-mid">
                        {formatDateTime(step.at)}{' '}
                        <span className="text-ink-soft">({relativeTime(step.at, now)})</span>
                    </p>
                )}
                <p className="prose-measure text-sm text-ink-soft">{step.detail}</p>
            </div>
        </li>
    )
}
