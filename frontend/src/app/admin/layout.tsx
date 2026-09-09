import { requireUser } from "@/lib/auth"
import { AppShell } from "@/components/shared/app-shell"

export const dynamic = "force-dynamic"

/**
 * Oversight, for every officer.
 *
 * One layout serves the whole chain of command. The API scopes each response to
 * the subtree the caller is actually posted to, so a sector officer, an
 * Executive Engineer and the CEO read the same screens and see their own patch
 * of the authority — which is the point of making the hierarchy a tree rather
 * than a set of role-specific pages that drift apart.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const user = await requireUser("SECTION_OFFICER")

    return <AppShell user={user}>{children}</AppShell>
}
