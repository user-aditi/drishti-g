import { redirect } from 'next/navigation'
import { auth, homeFor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * The root path belongs to whoever is signed in.
 *
 * Each level of the authority has a different job, so each gets a different
 * landing screen rather than one page with five modes inside it.
 */
export default async function RootPage() {
    const user = await auth()
    redirect(user ? homeFor(user.rank) : '/login')
}
