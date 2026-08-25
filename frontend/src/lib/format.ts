import type { ComplaintStatus, Priority, Rank, RiskBand, Trade } from './types'

/** Numeric seniority. Mirrors RANK_LEVEL in the backend's hierarchy service. */
export const RANK_LEVEL: Record<Rank, number> = {
  CITIZEN: 0,
  FIELD_WORKER: 1,
  SECTION_OFFICER: 2,
  CIRCLE_OFFICER: 3,
  ZONAL_OFFICER: 4,
  HOD: 5,
  CEO: 6,
  SUPER_ADMIN: 7,
}

export const RANK_LABEL: Record<Rank, string> = {
  CITIZEN: 'Citizen',
  FIELD_WORKER: 'Field Worker',
  SECTION_OFFICER: 'Section Officer',
  CIRCLE_OFFICER: 'Circle Officer',
  ZONAL_OFFICER: 'Zonal Officer',
  HOD: 'Head of Department',
  CEO: 'Chief Executive Officer',
  SUPER_ADMIN: 'System Administrator',
}

/** Short form for chips and org-chart tiers. */
export const RANK_SHORT: Record<Rank, string> = {
  CITIZEN: 'Citizen',
  FIELD_WORKER: 'Worker',
  SECTION_OFFICER: 'Section',
  CIRCLE_OFFICER: 'Circle',
  ZONAL_OFFICER: 'Zone',
  HOD: 'Dept Head',
  CEO: 'CEO',
  SUPER_ADMIN: 'Admin',
}

export const RANK_STYLE: Record<Rank, string> = {
  CITIZEN: 'bg-slate-100 text-slate-700',
  FIELD_WORKER: 'bg-teal-100 text-teal-800',
  SECTION_OFFICER: 'bg-brand-100 text-brand-800',
  CIRCLE_OFFICER: 'bg-indigo-100 text-indigo-800',
  ZONAL_OFFICER: 'bg-violet-100 text-violet-800',
  HOD: 'bg-purple-100 text-purple-800',
  CEO: 'bg-amber-100 text-amber-900',
  SUPER_ADMIN: 'bg-slate-800 text-white',
}

export const isOfficer = (rank: Rank): boolean => RANK_LEVEL[rank] >= RANK_LEVEL.SECTION_OFFICER
export const isAuthorityWide = (rank: Rank): boolean => rank === 'CEO' || rank === 'SUPER_ADMIN'
export const isSeniorOfficer = (rank: Rank): boolean =>
  RANK_LEVEL[rank] >= RANK_LEVEL.CIRCLE_OFFICER

export const TRADE_LABEL: Record<Trade, string> = {
  SAFAI_KARAMCHARI: 'Safai Karamchari',
  LINEMAN: 'Lineman',
  BELDAR: 'Beldar',
  MASON: 'Mason',
  PLUMBER: 'Plumber',
  MALI: 'Mali',
  DRIVER: 'Driver',
}

/** Presentation metadata for each status. Colours are Tailwind class fragments. */
export const STATUS_META: Record<
  ComplaintStatus,
  { label: string; className: string; dot: string }
> = {
  SUBMITTED: { label: 'Submitted', className: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  ROUTED: { label: 'Awaiting officer', className: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500' },
  ASSIGNED: { label: 'With officer', className: 'bg-brand-100 text-brand-800', dot: 'bg-brand-500' },
  IN_PROGRESS: { label: 'Work in progress', className: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  AWAITING_VERIFICATION: {
    label: 'Awaiting inspection',
    className: 'bg-violet-100 text-violet-800',
    dot: 'bg-violet-500',
  },
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
  { label: string; className: string; bar: string; text: string; hex: string }
> = {
  LOW: {
    label: 'Low',
    className: 'bg-emerald-100 text-emerald-800',
    bar: 'bg-risk-low',
    text: 'text-risk-low',
    hex: '#059669',
  },
  MODERATE: {
    label: 'Moderate',
    className: 'bg-yellow-100 text-yellow-800',
    bar: 'bg-risk-moderate',
    text: 'text-risk-moderate',
    hex: '#ca8a04',
  },
  HIGH: {
    label: 'High',
    className: 'bg-orange-100 text-orange-800',
    bar: 'bg-risk-high',
    text: 'text-risk-high',
    hex: '#ea580c',
  },
  SEVERE: {
    label: 'Severe',
    className: 'bg-red-100 text-red-800',
    bar: 'bg-risk-severe',
    text: 'text-risk-severe',
    hex: '#dc2626',
  },
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
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

/** Turn an SLA deadline into the phrase an officer actually needs. */
export function deadlineLabel(
  slaDueAt: string | null,
  stillOpen: boolean,
): { text: string; tone: 'overdue' | 'urgent' | 'normal' | 'none' } {
  if (!slaDueAt) return { text: 'No deadline set', tone: 'none' }

  const hoursLeft = (new Date(slaDueAt).getTime() - Date.now()) / 3_600_000

  if (!stillOpen) return { text: `Due ${formatDate(slaDueAt)}`, tone: 'none' }
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

export const DEADLINE_TONE: Record<string, string> = {
  overdue: 'bg-red-100 text-red-700',
  urgent: 'bg-amber-100 text-amber-700',
  normal: 'bg-slate-100 text-slate-600',
  none: 'bg-slate-100 text-slate-500',
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
export const OPEN_STATUSES: ComplaintStatus[] = [
  'SUBMITTED',
  'ROUTED',
  'ASSIGNED',
  'IN_PROGRESS',
  'AWAITING_VERIFICATION',
]

export const isOpen = (status: ComplaintStatus): boolean => OPEN_STATUSES.includes(status)

/** "Sector 62 · Work Circle 3" for a complaint's location line. */
export function locationLabel(sector: {
  number: number
  name: string
  circle?: { name: string } | null
} | null): string {
  if (!sector) return 'Location not resolved'
  const base = `Sector ${sector.number}`
  return sector.circle ? `${base} · ${sector.circle.name}` : base
}
