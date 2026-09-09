import { redirect } from 'next/navigation'
import { serverFetch } from './api'
import { RANK_LEVEL } from './constants'
import type { Rank, User } from '@/types'

/**
 * The current session, resolved on the server from the httpOnly cookie.
 *
 * Returns null rather than throwing when nobody is signed in, so a layout can
 * decide where to send them.
 */
export async function auth(): Promise<User | null> {
    try {
        return await serverFetch<User>('/auth/me')
    } catch {
        return null
    }
}

/**
 * Require a signed-in user, optionally of a minimum rank.
 *
 * Guarding here rather than in the browser means a page never renders before
 * the check runs — there is no protected content in the HTML for an
 * unauthorised viewer to see, even briefly.
 */
export async function requireUser(minRank?: Rank): Promise<User> {
    const user = await auth()
    if (!user) redirect('/login')

    if (minRank && RANK_LEVEL[user.rank] < RANK_LEVEL[minRank]) {
        redirect(homeFor(user.rank))
    }

    return user
}

/**
 * Where "/" means for a given rank.
 *
 * Each level of the authority has a different job, so each gets a different
 * landing screen rather than one page with five modes inside it.
 */
export function homeFor(rank: Rank): string {
    switch (rank) {
        case 'CITIZEN':
            return '/dashboard'
        case 'SECTION_OFFICER':
            return '/officer/desk'
        default:
            return '/admin/dashboard'
    }
}
