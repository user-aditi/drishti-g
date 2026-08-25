import type { ComplaintStatus, Priority, RiskBand, UserRole } from './types'

/** Presentation metadata for each status. Colours are Tailwind class fragments. */
export const STATUS_META: Record<
  ComplaintStatus,
  { label: string; className: string; dot: string }
> = {
  SUBMITTED: { label: 'Submitted', className: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  ROUTED: { label: 'Routed', className: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500' },
  ASSIGNED: { label: 'Assigned', className: 'bg-indigo-100 text-indigo-800', dot: 'bg-indigo-500' },
  IN_PROGRESS: { label: 'In progress', className: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  RESOLVED: { label: 'Resolved', className: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-500' },
  CLOSED: { label: 'Closed', className: 'bg-slate-200 text-slate-700', dot: 'bg-slate-500' },
  REJECTED: { label: 'Rejected', className: 'bg-red-100 text-red-800', dot: 'bg-red-500' },
  DUPLICATE: { label: 'Duplicate', className: 'bg-slate-100 text-slate-600', dot: 'bg-slate-400' },
}

export const PRIORITY_META: Record<Priority, { label: string; className: string }> = {
  LOW: { label: 'Low', className: 'bg-slate-100 text-slate-600' },
  MEDIUM: { label: 'Medium', className: 'bg-sky-100 text-sky-800' },
  HIGH: { label: 'High', className: 'bg-orange-100 text-orange-800' },
  CRITICAL: { label: 'Critical', className: 'bg-red-100 text-red-800' },
}

export const BAND_META: Record<
  RiskBand,
  { label: string; className: string; bar: string; text: string }
> = {
  LOW: {
    label: 'Low',
    className: 'bg-emerald-100 text-emerald-800',
    bar: 'bg-risk-low',
    text: 'text-risk-low',
  },
  MODERATE: {
    label: 'Moderate',
    className: 'bg-yellow-100 text-yellow-800',
    bar: 'bg-risk-moderate',
    text: 'text-risk-moderate',
  },
  HIGH: {
    label: 'High',
    className: 'bg-orange-100 text-orange-800',
    bar: 'bg-risk-high',
    text: 'text-risk-high',
  },
  SEVERE: {
    label: 'Severe',
    className: 'bg-red-100 text-red-800',
    bar: 'bg-risk-severe',
    text: 'text-risk-severe',
  },
}

export const ROLE_LABEL: Record<UserRole, string> = {
  CITIZEN: 'Citizen',
  FIELD_OFFICIAL: 'Field Official',
  ADMIN: 'Supervisor',
}

const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const dateTimeFmt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export const formatDate = (iso: string | null): string => (iso ? dateFmt.format(new Date(iso)) : '—')

export const formatDateTime = (iso: string | null): string =>
  iso ? dateTimeFmt.format(new Date(iso)) : '—'

/**
 * Relative time, in the direction the reader cares about.
 *
 * Deadlines read forward ("in 3 hours"), events read backward ("2 days ago").
 */
export function relativeTime(iso: string | null): string {
  if (!iso) return '—'
  const diffMs = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(diffMs)
  const future = diffMs > 0

  const minutes = Math.round(abs / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`

  const hours = Math.round(minutes / 60)
  if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`

  const days = Math.round(hours / 24)
  if (days < 30) return future ? `in ${days}d` : `${days}d ago`

  const months = Math.round(days / 30)
  return future ? `in ${months}mo` : `${months}mo ago`
}

/** Turn an SLA deadline into the phrase an official actually needs. */
export function deadlineLabel(slaDueAt: string | null, isOpen: boolean): {
  text: string
  tone: 'overdue' | 'urgent' | 'normal' | 'none'
} {
  if (!slaDueAt) return { text: 'No deadline set', tone: 'none' }

  const hoursLeft = (new Date(slaDueAt).getTime() - Date.now()) / 3_600_000

  if (!isOpen) return { text: `Due ${formatDate(slaDueAt)}`, tone: 'none' }
  if (hoursLeft < 0) {
    const overdueBy = Math.abs(Math.round(hoursLeft))
    return {
      text: overdueBy >= 24 ? `${Math.round(overdueBy / 24)}d overdue` : `${overdueBy}h overdue`,
      tone: 'overdue',
    }
  }
  if (hoursLeft < 12) return { text: `${Math.round(hoursLeft)}h left`, tone: 'urgent' }
  return { text: `${Math.round(hoursLeft / 24)}d left`, tone: 'normal' }
}

/** "complaint.status_changed" -> "Status changed" */
export function humaniseAction(action: string): string {
  const tail = action.includes('.') ? action.slice(action.indexOf('.') + 1) : action
  const spaced = tail.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export const initials = (name: string): string =>
  name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('')

/** Statuses that mean the complaint is still someone's problem. */
export const OPEN_STATUSES: ComplaintStatus[] = ['SUBMITTED', 'ROUTED', 'ASSIGNED', 'IN_PROGRESS']

export const isOpen = (status: ComplaintStatus): boolean => OPEN_STATUSES.includes(status)
