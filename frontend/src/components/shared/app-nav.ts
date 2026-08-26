import type { Rank, User } from '@/types'
import { isAuthorityWide, isSeniorOfficer } from '@/lib/constants'

export interface NavItem {
    href: string
    label: string
    /** lucide-react icon name, resolved in the client component. */
    icon: string
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

    if (rank === 'CITIZEN') {
        return [
            { href: '/dashboard', label: 'My complaints', icon: 'ClipboardList' },
            { href: '/complaints/new', label: 'Report an issue', icon: 'CirclePlus' },
            { href: '/departments', label: 'Departments', icon: 'Landmark' },
        ]
    }

    if (rank === 'FIELD_WORKER') {
        return [
            { href: '/worker/jobs', label: 'My jobs', icon: 'Hammer' },
            { href: '/worker/jobs/done', label: 'Completed', icon: 'CircleCheck' },
        ]
    }

    if (rank === 'SECTION_OFFICER') {
        return [
            { href: '/officer/desk', label: 'My desk', icon: 'Inbox' },
            { href: '/officer/inspect', label: 'To inspect', icon: 'SearchCheck' },
            { href: '/officer/map', label: 'Sector map', icon: 'Map' },
            { href: '/officer/done', label: 'Completed', icon: 'CircleCheck' },
        ]
    }

    // Circle Officer and above get oversight rather than a personal desk.
    const items: NavItem[] = [
        { href: '/admin/dashboard', label: 'Overview', icon: 'LayoutDashboard' },
        { href: '/admin/escalations', label: 'Escalated to me', icon: 'ArrowUpCircle' },
        { href: '/admin/complaints', label: 'Complaints', icon: 'ClipboardList' },
        { href: '/admin/map', label: 'Map', icon: 'Map' },
        { href: '/admin/risk', label: 'Risk queue', icon: 'Target' },
        { href: '/admin/sectors', label: 'Sector risk', icon: 'MapPin' },
    ]

    if (isSeniorOfficer(rank)) items.push({ href: '/admin/org', label: 'Org chart', icon: 'Network' })
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
