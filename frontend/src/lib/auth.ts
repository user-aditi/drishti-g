import { redirect } from 'next/navigation'
import { serverFetch } from './api'
import { homeFor } from './routes'
import type { Role, User } from '@/types'

export { homeFor }

/**
 * The current session, resolved on the server from the httpOnly cookie.
 *
 * Returns null rather than throwing when nobody is signed in, so a layout can
 * decide where to send them instead of falling into an error boundary.
 */
export async function auth(): Promise<User | null> {
    try {
        return await serverFetch<User>('/auth/me')
    } catch {
        return null
    }
}

/**
 * Require a signed-in user, and optionally a role.
 *
 * Guarding on the server rather than in the browser means the page never
 * renders before the check runs: there is no queue data in the HTML for an
 * unauthorised viewer to read out of the source, even briefly.
 */
export async function requireUser(role?: Role): Promise<User> {
    const user = await auth()
    if (!user) redirect('/login')
    if (role && user.role !== role) redirect(homeFor(user.role))
    return user
}
