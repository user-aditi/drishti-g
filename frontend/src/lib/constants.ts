import type { Channel, QueueSort, RequestStatus, Role } from '@/types'

/**
 * Labels and tones for the closed vocabularies NYC publishes.
 *
 * These live in one file because a status has to look identical in a register
 * row, a detail header, a filter dropdown and a map popup — and the only way
 * that holds across a dozen screens is if there is exactly one place to change
 * it.
 */

/** Which of the three status families a state belongs to. */
export type StatusTone = 'wait' | 'done' | 'neutral'

export const STATUS_META: Record<RequestStatus, { label: string; tone: StatusTone }> = {
    OPEN: { label: 'Open', tone: 'wait' },
    ASSIGNED: { label: 'Assigned', tone: 'wait' },
    STARTED: { label: 'Started', tone: 'wait' },
    IN_PROGRESS: { label: 'In progress', tone: 'wait' },
    PENDING: { label: 'Pending', tone: 'wait' },
    CLOSED: { label: 'Closed', tone: 'done' },
    UNSPECIFIED: { label: 'Unspecified', tone: 'neutral' },
}

/** Every status in the order a reader expects to meet them. */
export const STATUSES: RequestStatus[] = [
    'OPEN',
    'ASSIGNED',
    'STARTED',
    'IN_PROGRESS',
    'PENDING',
    'CLOSED',
    'UNSPECIFIED',
]

/** Still being worked. Derived from the status, because "open" is not a status. */
export const isOpenStatus = (status: RequestStatus): boolean => status !== 'CLOSED'

export const CHANNEL_LABEL: Record<Channel, string> = {
    PHONE: 'Phone',
    ONLINE: 'Online',
    MOBILE: 'Mobile app',
    OTHER: 'Other',
    UNKNOWN: 'Not recorded',
}

/** The channels a person can actually pick when filing here. */
export const FILEABLE_CHANNELS: Channel[] = ['ONLINE', 'PHONE', 'MOBILE', 'OTHER']

export const ROLE_LABEL: Record<Role, string> = {
    CITIZEN: 'Public',
    AGENT: 'Agency staff',
    OFFICER: 'Officer',
    SUPERVISOR: 'Supervisor',
    COMMISSIONER: 'Commissioner',
}

/**
 * Brooklyn's centre, and the zoom at which all 18 community boards fit.
 *
 * The map opens on the whole borough because the register is already the tool
 * for looking at one board; the map's job is the shape of the borough.
 */
export const BROOKLYN_CENTRE: [number, number] = [40.6501, -73.9496]
export const BROOKLYN_ZOOM = 12

/** Loose bounds on Brooklyn, used to sanity-check a typed coordinate. */
export const BROOKLYN_BOUNDS = { south: 40.55, west: -74.06, north: 40.74, east: -73.83 }

/** Page sizes offered on the register. Anything larger stops being readable. */
export const PAGE_SIZES = [25, 50, 100, 200]
export const DEFAULT_PAGE_SIZE = 50

/**
 * The three orderings the register offers.
 *
 * Exactly the three the API implements, and no more. A header that offered a
 * fourth would have to sort the page it was handed, which with 355,430 rows
 * behind the register means sorting fifty of them and calling it an order —
 * a bug that looks like a feature until someone reaches page two.
 *
 * `age` is the default because the oldest open request is the one that has been
 * failing someone longest.
 */
export const QUEUE_SORTS: { value: QueueSort; label: string; hint: string }[] = [
    { value: 'age', label: 'Oldest first', hint: 'Longest-waiting request at the top' },
    { value: 'newest', label: 'Newest first', hint: 'Most recently filed at the top' },
    { value: 'due', label: 'Deadline', hint: 'Closest to its derived deadline first' },
]

export const DEFAULT_SORT: QueueSort = 'age'

/** Whatever was in the URL, narrowed to something the API accepts. */
export const parseSort = (raw: string | undefined): QueueSort =>
    QUEUE_SORTS.some((s) => s.value === raw) ? (raw as QueueSort) : DEFAULT_SORT

/**
 * The seeded sign-ins, offered on the login screen.
 *
 * `.invalid` is reserved by RFC 2606, so these addresses cannot reach a real
 * inbox and cannot collide with a real person's — which is the point. They are
 * fixtures in a replica, and the domain says so before any badge has to.
 */
export const SEED_PASSWORD = 'drishti-demo-2026'

export const SEED_ACCOUNTS: { email: string; label: string; hint: string }[] = [
    {
        email: 'resident@synthetic.drishti.invalid',
        label: 'Sample Resident',
        hint: 'Files requests and follows their own',
    },
    {
        email: 'dot.agent@synthetic.drishti.invalid',
        label: 'DOT Duty Agent',
        hint: 'Street and street-light conditions',
    },
    {
        email: 'dsny.agent@synthetic.drishti.invalid',
        label: 'DSNY Duty Agent',
        hint: 'Missed collections and dirty conditions',
    },
    {
        email: 'dep.agent@synthetic.drishti.invalid',
        label: 'DEP Duty Agent',
        hint: 'Sewer and water-system conditions',
    },
    {
        email: 'dot.officer.bk04@synthetic.drishti.invalid',
        label: 'DOT Officer · BK-04',
        hint: 'Layer 1 — answers for specific requests, issues work orders',
    },
    {
        email: 'dot.supervisor@synthetic.drishti.invalid',
        label: 'DOT Supervisor · Brooklyn',
        hint: 'Layer 1 — assigns requests to named officers',
    },
    {
        email: 'dot.commissioner@synthetic.drishti.invalid',
        label: 'DOT Borough Commissioner · Brooklyn',
        hint: 'Layer 2 — the top of the escalation ladder',
    },
]

/**
 * The dataset this replica is built on.
 *
 * Cited in the footer of every page. `erm2-nwe9` is the NYC Open Data resource
 * id for 311 Service Requests from 2010 to present.
 */
export const DATASET = {
    name: 'NYC 311 Service Requests from 2010 to Present',
    resourceId: 'erm2-nwe9',
    url: 'https://data.cityofnewyork.us/Social-Services/311-Service-Requests-from-2010-to-Present/erm2-nwe9',
    portal: 'NYC Open Data',
    rows: 355_430,
    borough: 'Brooklyn',
    span: '2022–2025',
} as const

/**
 * The sentence that has to be true on every screen showing a deadline.
 *
 * NYC publishes a `due_date` column, and for these six complaint types it is
 * empty in all 355,430 rows. Every deadline in this system was therefore
 * derived from how long requests of that type actually took to close. Showing
 * one without saying so would put words in the City's mouth.
 */
export const SLA_DISCLOSURE =
    'NYC publishes no due date for these complaint types — the field is empty in all ' +
    '355,430 records. Every deadline shown here is derived from the citywide 75th ' +
    'percentile of observed closure time for that type. It is an analytical baseline, ' +
    'not a commitment made by the City of New York.'
