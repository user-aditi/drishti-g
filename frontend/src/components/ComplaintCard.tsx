import { Link } from 'react-router-dom'
import { DEADLINE_TONE, deadlineLabel, formatDate, isOpen, relativeTime } from '../lib/format'
import type { Complaint } from '../lib/types'
import { PriorityPill, StatusPill } from './ui'

/**
 * One complaint in a list.
 *
 * `to` is passed in rather than derived, because the same complaint is reached
 * at /complaints/:id by a citizen and /tasks/:id by the official who owns it.
 */
export default function ComplaintCard({
  complaint,
  to,
  showDeadline = false,
}: {
  complaint: Complaint
  to: string
  showDeadline?: boolean
}) {
  const open = isOpen(complaint.status)
  const deadline = deadlineLabel(complaint.slaDueAt, open)

  return (
    <Link
      to={to}
      className="card block p-4 transition-all hover:border-brand-300 hover:shadow-lift"
    >
      <div className="flex items-start gap-3">
        <div
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg"
          aria-hidden
        >
          {complaint.category?.icon ?? '📋'}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 className="min-w-0 flex-1 truncate font-medium text-slate-900">
              {complaint.title}
            </h3>
            <StatusPill status={complaint.status} />
          </div>

          <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-slate-600">
            {complaint.description}
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-slate-500">
            <span className="font-mono text-[11px] text-slate-400">{complaint.referenceNo}</span>
            {complaint.sector && <span>Sector {complaint.sector.number}</span>}
            {complaint.department && <span>{complaint.department.name}</span>}
            <span title={formatDate(complaint.createdAt)}>{relativeTime(complaint.createdAt)}</span>

            {showDeadline && complaint.slaDueAt && (
              <span className={`rounded px-1.5 py-0.5 font-medium ${DEADLINE_TONE[deadline.tone]}`}>
                {deadline.text}
              </span>
            )}
            {complaint.escalationLevel > 0 && (
              <span className="pill bg-purple-100 text-purple-800">
                ⬆️ Escalated
              </span>
            )}
            {complaint.priority !== 'MEDIUM' && <PriorityPill priority={complaint.priority} />}
          </div>
        </div>
      </div>
    </Link>
  )
}
