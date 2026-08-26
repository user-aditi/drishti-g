import { requireUser } from "@/lib/auth"
import { AppShell } from "@/components/shared/app-shell"

export const dynamic = "force-dynamic"

/** The Section Officer desk — Junior Engineer or Sanitary Inspector. */
export default async function OfficerLayout({ children }: { children: React.ReactNode }) {
    const user = await requireUser("SECTION_OFFICER")

    return <AppShell user={user}>{children}</AppShell>
}
