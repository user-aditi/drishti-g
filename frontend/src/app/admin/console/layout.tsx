import { requireUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

/**
 * The control room is Super Admin only.
 *
 * The admin layout above already guards Circle Officer and up and draws the
 * chrome; this narrows that to the one rank allowed to reshape the authority.
 * Guarding on the server means a General Manager who guesses the URL never
 * receives the HTML, not merely a hidden nav entry.
 */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
    await requireUser('SUPER_ADMIN')
    return children
}
