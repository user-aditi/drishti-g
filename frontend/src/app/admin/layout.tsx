import { requireUser } from "@/lib/auth"
import { AppShell } from "@/components/shared/app-shell"

export const dynamic = "force-dynamic"

/**
 * Oversight, from Circle Officer upward.
 *
 * One layout serves every senior rank: the API scopes its responses to whatever
 * the caller’s postings actually cover, so an Executive Engineer sees their
 * circle and the CEO sees the authority from the same screens.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const user = await requireUser("CIRCLE_OFFICER")

    return <AppShell user={user}>{children}</AppShell>
}
