import type { Role } from '@/types'

/**
 * Where signing in should land someone.
 *
 * Kept apart from `lib/auth.ts` because that module reaches for `next/headers`
 * and is therefore server-only, while the sign-in form that needs this answer
 * runs in the browser. One line of routing is not worth pulling the whole
 * server client into a client bundle.
 *
 * The public and the people working the queue want different first screens,
 * and neither of them wants a dashboard.
 */
export const homeFor = (role: Role): string =>
    role === 'AGENT' ? '/agency/queue' : '/my/requests'
