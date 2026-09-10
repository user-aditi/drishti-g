import { redirect } from 'next/navigation'
import { auth, homeFor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * The sign-in screens sit inside the normal shell — header, footer, disclaimer
 * — because the footer's labelling obligation has no exceptions, and someone
 * arriving straight at a login page is exactly the reader most likely to
 * mistake this for the City's own service.
 *
 * Anyone already signed in is bounced to their own first screen; a sign-in form
 * offered to someone with a session is a dead end that looks like a bug.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
    const user = await auth()
    if (user) redirect(homeFor(user.role))

    return <>{children}</>
}
