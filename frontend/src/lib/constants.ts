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
    CITIZEN: 'bg-[color:var(--neutral-bg)] text-[color:var(--neutral-fg)]',
    FIELD_WORKER: 'bg-[color:var(--info-bg)] text-[color:var(--info-fg)]',
    SECTION_OFFICER: 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]',
    CIRCLE_OFFICER: 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]',
    ZONAL_OFFICER: 'bg-[color:var(--escalate-bg)] text-[color:var(--escalate-fg)]',
    HOD: 'bg-[color:var(--escalate-bg)] text-[color:var(--escalate-fg)]',
    CEO: 'bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]',
    SUPER_ADMIN: 'bg-[color:var(--primary)] text-[color:var(--primary-foreground)]',
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
        className: 'bg-[color:var(--neutral-bg)] text-[color:var(--neutral-fg)]',
        dot: 'bg-[color:var(--status-submitted)]',
        hex: '#98A2B3',
    },
    ROUTED: {
        label: 'Awaiting officer',
        className: 'bg-[color:var(--info-bg)] text-[color:var(--info-fg)]',
        dot: 'bg-[color:var(--status-routed)]',
        hex: '#0EA5E9',
    },
    ASSIGNED: {
        label: 'With officer',
        className: 'bg-[color:var(--accent)] text-[color:var(--accent-foreground)]',
        dot: 'bg-[color:var(--status-assigned)]',
        hex: '#4F46E5',
    },
    IN_PROGRESS: {
        label: 'Work in progress',
        className: 'bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]',
        dot: 'bg-[color:var(--status-in-progress)]',
        hex: '#F59E0B',
    },
    AWAITING_VERIFICATION: {
        label: 'Awaiting inspection',
        className: 'bg-[color:var(--escalate-bg)] text-[color:var(--escalate-fg)]',
        dot: 'bg-[color:var(--status-awaiting)]',
        hex: '#8B5CF6',
    },
    RESOLVED: {
        label: 'Resolved',
        className: 'bg-[color:var(--success-bg)] text-[color:var(--success-fg)]',
        dot: 'bg-[color:var(--status-resolved)]',
        hex: '#10B981',
    },
    CLOSED: {
        label: 'Closed',
        className: 'bg-[color:var(--neutral-bg)] text-[color:var(--neutral-fg)]',
        dot: 'bg-[color:var(--status-closed)]',
        hex: '#667085',
    },
    REJECTED: {
        label: 'Rejected',
        className: 'bg-[color:var(--error-bg)] text-[color:var(--error-fg)]',
        dot: 'bg-[color:var(--status-rejected)]',
        hex: '#EF4444',
    },
    DUPLICATE: {
        label: 'Duplicate',
        className: 'bg-[color:var(--neutral-bg)] text-[color:var(--neutral-fg)]',
        dot: 'bg-[color:var(--status-submitted)]',
        hex: '#98A2B3',
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
    LOW: { label: 'Low', className: 'bg-[color:var(--neutral-bg)] text-[color:var(--neutral-fg)]' },
    MEDIUM: { label: 'Medium', className: 'bg-[color:var(--info-bg)] text-[color:var(--info-fg)]' },
    HIGH: { label: 'High', className: 'bg-[color:var(--warning-bg)] text-[color:var(--warning-fg)]' },
    CRITICAL: { label: 'Critical', className: 'bg-[color:var(--error-bg)] text-[color:var(--error-fg)]' },
}

// --- GRIE --------------------------------------------------------------------

export const BAND_META: Record<
    RiskBand,
    { label: string; className: string; bar: string; text: string; hex: string }
> = {
    LOW: {
        label: 'Low',
        className: 'bg-[color:var(--success-bg)] text-[color:var(--success-fg)]',
        bar: 'bg-[color:var(--risk-low)]',
        text: 'text-[color:var(--risk-low)]',
        hex: '#059669',
    },
    MODERATE: {
        label: 'Moderate',
        className: 'bg-[color:var(--risk-moderate-bg)] text-[color:var(--risk-moderate-fg)]',
        bar: 'bg-[color:var(--risk-moderate)]',
        text: 'text-[color:var(--risk-moderate)]',
        hex: '#CA8A04',
    },
    HIGH: {
        label: 'High',
        className: 'bg-[color:var(--risk-high-bg)] text-[color:var(--risk-high-fg)]',
        bar: 'bg-[color:var(--risk-high)]',
        text: 'text-[color:var(--risk-high)]',
        hex: '#EA580C',
    },
    SEVERE: {
        label: 'Severe',
        className: 'bg-[color:var(--error-bg)] text-[color:var(--error-fg)]',
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
/**
 * The demo accounts, one per layer of the tree.
 *
 * Deliberately ordered from the ground up, because that is the order a
 * complaint travels: a resident files it, the sector officer works it, and it
 * climbs only when a deadline is missed. Each hint names the layer the account
 * actually sits at, so the demo shows the hierarchy rather than describing it.
 *
 * There is no field-worker account, and there must never be one again: street
 * labour reaches the system through a per-job code at /w/<code>, with no login
 * at all. The old Beldar entry here pointed at a switched-off account and
 * simply failed to sign in.
 */
export const DEMO_ACCOUNTS = [
    {
        email: 'citizen@example.com',
        label: 'Citizen',
        hint: 'Report an issue and follow it',
    },
    {
        email: 'je.s5.civil@noidaauthority.in',
        label: 'Sector Officer — Sector 5',
        hint: 'The ground floor: triages complaints and sends crew out with a code',
    },
    {
        email: 'ee.wc5.civil@noidaauthority.in',
        label: 'Zone Officer — Zone III',
        hint: 'One layer up: overdue work from six sectors climbs to here',
    },
    {
        email: 'gm.civil@noidaauthority.in',
        label: 'General Manager (Civil)',
        hint: 'The whole city for one department, and the risk queue',
    },
    {
        email: 'admin@drishti.gov.in',
        label: 'Super Admin',
        hint: 'Shapes the authority itself — layers, units and postings',
    },
]
