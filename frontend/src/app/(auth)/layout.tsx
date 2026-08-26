import { redirect } from 'next/navigation'
import { auth, homeFor } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * Auth screens render outside the app shell — there is no navigation to show
 * yet — and bounce anyone who is already signed in.
 */
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
    const user = await auth()
    if (user) redirect(homeFor(user.rank))

    return <div className="min-h-screen">{children}</div>
}
