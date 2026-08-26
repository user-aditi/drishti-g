import type { ComplaintStatus, Priority, Rank, RiskBand, Trade } from '@/types'

/**
 * Presentation metadata for the domain enums.
 *
 * Kept in one file so a status colour or a rank label is defined once and every
 * badge, chart and map pin agrees. The keys mirror the Prisma enums in
 * backend/prisma/schema.prisma — keep the two in step.
 */

// --- Chain of command --------------------------------------------------------

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

export const RANK_STYLE: Record<Rank, string> = {
    CITIZEN: 'bg-slate-100 text-slate-700',
    FIELD_WORKER: 'bg-teal-100 text-teal-800',
    SECTION_OFFICER: 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]',
    CIRCLE_OFFICER: 'bg-indigo-100 text-indigo-800',
    ZONAL_OFFICER: 'bg-violet-100 text-violet-800',
    HOD: 'bg-purple-100 text-purple-800',
    CEO: 'bg-amber-100 text-amber-900',
    SUPER_ADMIN: 'bg-slate-800 text-white',
}

export const isOfficer = (rank: Rank): boolean => RANK_LEVEL[rank] >= RANK_LEVEL.SECTION_OFFICER
export const isSeniorOfficer = (rank: Rank): boolean => RANK_LEVEL[rank] >= RANK_LEVEL.CIRCLE_OFFICER
export const isAuthorityWide = (rank: Rank): boolean => rank === 'CEO' || rank === 'SUPER_ADMIN'

export const TRADE_LABEL: Record<Trade, string> = {
    SAFAI_KARAMCHARI: 'Safai Karamchari',
    LINEMAN: 'Lineman',
    BELDAR: 'Beldar',
    MASON: 'Mason',
    PLUMBER: 'Plumber',
    MALI: 'Mali',
    DRIVER: 'Driver',
}

// --- Complaint lifecycle -----------------------------------------------------

export interface StatusMeta {
    label: string
    /** Badge classes. */
    className: string
    /** Solid colour for dots and bars. */
    dot: string
    /** Raw hex, for the map and charts. */
    hex: string
}

export const STATUS_META: Record<ComplaintStatus, StatusMeta> = {
    SUBMITTED: {
        label: 'Submitted',
        className: 'bg-slate-100 text-slate-700',
        dot: 'bg-slate-400',
        hex: '#94A3B8',
    },
    ROUTED: {
        label: 'Awaiting officer',
        className: 'bg-sky-100 text-sky-800',
        dot: 'bg-sky-500',
        hex: '#0EA5E9',
    },
    ASSIGNED: {
        label: 'With officer',
        className: 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]',
        dot: 'bg-[color:var(--primary)]',
        hex: '#2F7F83',
    },
    IN_PROGRESS: {
        label: 'Work in progress',
        className: 'bg-amber-100 text-amber-800',
        dot: 'bg-amber-500',
        hex: '#F59E0B',
    },
    AWAITING_VERIFICATION: {
        label: 'Awaiting inspection',
        className: 'bg-violet-100 text-violet-800',
        dot: 'bg-violet-500',
        hex: '#8B5CF6',
    },
    RESOLVED: {
        label: 'Resolved',
        className: 'bg-emerald-100 text-emerald-800',
        dot: 'bg-emerald-500',
        hex: '#10B981',
    },
    CLOSED: {
        label: 'Closed',
        className: 'bg-slate-200 text-slate-700',
        dot: 'bg-slate-500',
        hex: '#64748B',
    },
    REJECTED: {
        label: 'Rejected',
        className: 'bg-red-100 text-red-800',
        dot: 'bg-red-500',
        hex: '#EF4444',
    },
    DUPLICATE: {
        label: 'Duplicate',
        className: 'bg-slate-100 text-slate-600',
        dot: 'bg-slate-400',
        hex: '#94A3B8',
    },
}

/** Statuses that mean the complaint is still someone's problem. */
export const OPEN_STATUSES: ComplaintStatus[] = [
    'SUBMITTED',
    'ROUTED',
    'ASSIGNED',
    'IN_PROGRESS',
    'AWAITING_VERIFICATION',
]

export const isOpen = (status: ComplaintStatus): boolean => OPEN_STATUSES.includes(status)

/** Submission through to closure, for funnels and progress bars. */
export const STATUS_FUNNEL: ComplaintStatus[] = [
    'SUBMITTED',
    'ROUTED',
    'ASSIGNED',
    'IN_PROGRESS',
    'AWAITING_VERIFICATION',
    'RESOLVED',
    'CLOSED',
]

export const PRIORITY_META: Record<Priority, { label: string; className: string }> = {
    LOW: { label: 'Low', className: 'bg-slate-100 text-slate-600' },
    MEDIUM: { label: 'Medium', className: 'bg-sky-100 text-sky-800' },
    HIGH: { label: 'High', className: 'bg-orange-100 text-orange-800' },
    CRITICAL: { label: 'Critical', className: 'bg-red-100 text-red-800' },
}

// --- GRIE --------------------------------------------------------------------

export const BAND_META: Record<
    RiskBand,
    { label: string; className: string; bar: string; text: string; hex: string }
> = {
    LOW: {
        label: 'Low',
        className: 'bg-emerald-100 text-emerald-800',
        bar: 'bg-[color:var(--risk-low)]',
        text: 'text-[color:var(--risk-low)]',
        hex: '#059669',
    },
    MODERATE: {
        label: 'Moderate',
        className: 'bg-yellow-100 text-yellow-800',
        bar: 'bg-[color:var(--risk-moderate)]',
        text: 'text-[color:var(--risk-moderate)]',
        hex: '#CA8A04',
    },
    HIGH: {
        label: 'High',
        className: 'bg-orange-100 text-orange-800',
        bar: 'bg-[color:var(--risk-high)]',
        text: 'text-[color:var(--risk-high)]',
        hex: '#EA580C',
    },
    SEVERE: {
        label: 'Severe',
        className: 'bg-red-100 text-red-800',
        bar: 'bg-[color:var(--risk-severe)]',
        text: 'text-[color:var(--risk-severe)]',
        hex: '#DC2626',
    },
}

export const ENTITY_LABEL: Record<string, string> = {
    SECTOR: 'Sector',
    CIRCLE: 'Work circle',
    ZONE: 'Zone',
    DEPARTMENT: 'Department',
    CONTRACTOR: 'Contractor',
    PROJECT: 'Project',
}

// --- Geography ---------------------------------------------------------------

/** Noida's approximate centre, so the map opens on the city. */
export const NOIDA_CENTRE: [number, number] = [28.5706, 77.351]

export const DEMO_PASSWORD = 'drishti123'

/** Seeded accounts, so a reviewer can get in without reading the README. */
export const DEMO_ACCOUNTS = [
    {
        email: 'admin@drishti.gov.in',
        label: 'Super Admin',
        hint: 'Every department and zone, the whole org chart',
    },
    {
        email: 'gm.civil@noidaauthority.in',
        label: 'General Manager (Civil)',
        hint: 'Department-wide oversight and the risk queue',
    },
    {
        email: 'ee.wc5.civil@noidaauthority.in',
        label: 'Executive Engineer',
        hint: 'Work Circle 5 — escalations land here',
    },
    {
        email: 'je.s5.civil@noidaauthority.in',
        label: 'Junior Engineer',
        hint: 'Sector 5 desk — allot work to your crew',
    },
    {
        email: 'worker1.s5.civil@noidaauthority.in',
        label: 'Beldar',
        hint: 'Field worker — the phone view',
    },
    { email: 'citizen@example.com', label: 'Citizen', hint: 'Report an issue and track it' },
]
