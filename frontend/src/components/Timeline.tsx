import { ROLE_LABEL, STATUS_META, formatDateTime } from '../lib/format'
import type { HistoryEntry } from '../lib/types'

/**
 * The complaint's journey, oldest first.
 *
 * This is the citizen-facing payoff of routing everything through GCCE: every
 * step, who took it, and why, in one readable column.
 */
export default function Timeline({ history }: { history: HistoryEntry[] }) {
  if (history.length === 0) {
    return <p className="text-sm text-slate-500">No activity recorded yet.</p>
  }

  return (
    <ol className="relative space-y-6 pl-6">
      {/* The spine. Stops short of the last dot so it does not dangle. */}
      <span
        className="absolute bottom-3 left-[5px] top-2 w-px bg-slate-200"
        aria-hidden
      />

      {history.map((entry) => {
        const meta = STATUS_META[entry.toStatus]
        const isGcce = entry.note?.startsWith('Routed by GCCE')

        return (
          <li key={entry.id} className="relative">
            <span
              className={`absolute -left-6 top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-white ${meta.dot}`}
              aria-hidden
            />

            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-slate-900">{meta.label}</span>
              <time className="text-xs text-slate-500" dateTime={entry.createdAt}>
                {formatDateTime(entry.createdAt)}
              </time>
            </div>

            {entry.note && (
              <p
                className={`mt-1 text-sm leading-relaxed ${
                  isGcce ? 'text-slate-600' : 'text-slate-700'
                }`}
              >
                {entry.note}
              </p>
            )}

            <div className="mt-1.5 flex flex-wrap items-center gap-2">
              {isGcce ? (
                <span className="pill bg-brand-50 text-brand-700">Decided by GCCE</span>
              ) : (
                entry.actor && (
                  <span className="text-xs text-slate-500">
                    {entry.actor.fullName}
                    <span className="text-slate-400"> · {ROLE_LABEL[entry.actor.role]}</span>
                  </span>
                )
              )}
            </div>

            {entry.evidenceUrl && (
              <a
                href={entry.evidenceUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2.5 block w-fit overflow-hidden rounded-lg border border-slate-200 transition-shadow hover:shadow-lift"
              >
                <img
                  src={entry.evidenceUrl}
                  alt="Evidence submitted by the field official"
                  className="h-32 w-auto object-cover"
                  loading="lazy"
                />
                <span className="block bg-slate-50 px-2 py-1 text-[11px] text-slate-500">
                  Evidence photo — click to enlarge
                </span>
              </a>
            )}
          </li>
        )
      })}
    </ol>
  )
}
