import { requireUser } from "@/lib/auth"
import { AppShell } from "@/components/shared/app-shell"

export const dynamic = "force-dynamic"

/**
 * Citizen-facing screens.
 *
 * The guard runs before anything renders, so a signed-out visitor never
 * receives protected markup — not even briefly.
 */
export default async function CitizenLayout({ children }: { children: React.ReactNode }) {
    const user = await requireUser()

    return <AppShell user={user}>{children}</AppShell>
}
