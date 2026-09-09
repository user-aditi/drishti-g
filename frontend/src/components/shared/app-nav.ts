import type { Rank, User } from '@/types'
import { isAuthorityWide } from '@/lib/constants'

export interface NavItem {
    href: string
    label: string
    /** lucide-react icon name, resolved in the client component. */
    icon: string
    /**
     * Heading this item sits under. Items without one render ungrouped, which
     * is what every role except the Super Admin wants — a flat list of four
     * things needs no headings.
     */
    section?: string
}

/**
 * Navigation for a person, derived from their rank.
 *
 * Built from the rank rather than a stored menu, so appointing someone to a new
 * post immediately gives them the right app. The backend enforces access
 * independently — this is a convenience, never the access control.
 */
export function navFor(user: User): NavItem[] {
    const rank: Rank = user.rank

    /**
     * A resident's navigation, in plain words.
     *
     * Six items, each naming a thing a person actually wants — not a module.
     * "Who to contact" rather than "Departments", because nobody opens a civic
     * app looking for an org chart; they are looking for the person who can fix
     * their street. Deliberately flat and ungrouped: six is few enough to read
     * at a glance, and headings would imply a structure worth learning.
     */
    if (rank === 'CITIZEN') {
        return [
            { href: '/dashboard', label: 'My complaints', icon: 'ClipboardList' },
            { href: '/complaints/new', label: 'Report an issue', icon: 'CirclePlus' },
            { href: '/community', label: 'My neighbourhood', icon: 'Users' },
            { href: '/contacts', label: 'Who to contact', icon: 'Phone' },
            { href: '/profile', label: 'My profile', icon: 'UserRound' },
        ]
    }

    if (rank === 'SECTION_OFFICER') {
        return [
            { href: '/officer/desk', label: 'My desk', icon: 'Inbox' },
            // Named for what it is now: the small set neither the automated
            // checks nor the resident could settle, rather than every closure
            // in the sector.
            { href: '/officer/inspect', label: 'Needs my decision', icon: 'SearchCheck' },
            { href: '/officer/crew', label: 'My crew', icon: 'HardHat' },
            // The same tree screen everyone above uses, entered at this
            // officer's own sector rather than at the city.
            { href: '/admin/org', label: 'My sector', icon: 'Network' },
            { href: '/admin/map', label: 'Map', icon: 'Map' },
            { href: '/officer/done', label: 'Completed', icon: 'CircleCheck' },
        ]
    }

    // A field worker has no account any more: street labour is contractual and
    // reaches the system through a per-job code instead. The branch is kept so
    // a legacy account that somehow signs in still lands somewhere sane.
    if (rank === 'FIELD_WORKER') {
        return [{ href: '/officer/desk', label: 'My desk', icon: 'Inbox' }]
    }

    /**
     * The Super Admin does a different job from everyone above Circle Officer:
     * they do not work the queue, they decide what the queue is made of.
     *
     * Grouped the way the head of an authority actually divides the world — the
     * ground, the organisation on it, the work being done, and the checks on
     * both — rather than by which database table a screen happens to read. Each
     * entry is an entry *point*: the detail lives one drill-down below it, not
     * in a sibling menu item.
     */
    if (rank === 'SUPER_ADMIN') {
        return [
            { href: '/admin/org', label: 'Org tree', icon: 'Network', section: 'The city' },
            { href: '/admin/map', label: 'Map', icon: 'Map', section: 'The city' },

            { href: '/admin/console/departments', label: 'Departments', icon: 'Landmark', section: 'Organisation' },
            { href: '/admin/console/staff', label: 'Officers & staff', icon: 'Users', section: 'Organisation' },
            { href: '/admin/console/citizens', label: 'Citizens', icon: 'UserRound', section: 'Organisation' },

            { href: '/admin/console/complaints', label: 'Complaints', icon: 'ClipboardList', section: 'Work' },

            { href: '/admin/risk', label: 'Risk queue', icon: 'Target', section: 'Oversight' },
            { href: '/admin/decisions', label: 'Decisions', icon: 'GitBranch', section: 'Oversight' },
            { href: '/admin/autonomy', label: 'Autonomy gate', icon: 'ShieldOff', section: 'Oversight' },
            { href: '/admin/audit', label: 'Audit trail', icon: 'ShieldCheck', section: 'Oversight' },
        ]
    }

    // Circle Officer and above get oversight rather than a personal desk.
    const items: NavItem[] = [
        { href: '/admin/dashboard', label: 'Overview', icon: 'LayoutDashboard' },
        { href: '/admin/escalations', label: 'Escalated to me', icon: 'ArrowUpCircle' },
        { href: '/admin/complaints', label: 'Complaints', icon: 'ClipboardList' },
        // One entry for the shape of the authority. This replaced both the old
        // org chart and the separate sector-risk list, which were two readings
        // of the same tree.
        { href: '/admin/org', label: 'My patch', icon: 'Network' },
        { href: '/admin/map', label: 'Map', icon: 'Map' },
        { href: '/admin/risk', label: 'Risk queue', icon: 'Target' },
    ]

    if (isAuthorityWide(rank)) {
        items.push({ href: '/admin/departments', label: 'Departments', icon: 'Landmark' })
        items.push({ href: '/admin/people', label: 'People', icon: 'Users' })
        items.push({ href: '/admin/audit', label: 'Audit trail', icon: 'ShieldCheck' })
    }

    return items
}

/** Where this person sits, in one line under their name. */
export function postingLine(user: User): string {
    const posting = user.primaryPosting
    if (!posting) {
        return user.homeSector ? `Citizen · Sector ${user.homeSector.number}` : 'Citizen'
    }

    const place = posting.sector
        ? `Sector ${posting.sector.number}`
        : (posting.circle?.name ?? posting.zone?.name ?? null)

    return [posting.designationTitle, place].filter(Boolean).join(' · ')
}
