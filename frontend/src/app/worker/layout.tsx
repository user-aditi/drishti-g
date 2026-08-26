import { requireUser } from "@/lib/auth"
import { AppShell } from "@/components/shared/app-shell"

export const dynamic = "force-dynamic"

/** Field workers: safai karamchari, lineman, beldar. */
export default async function WorkerLayout({ children }: { children: React.ReactNode }) {
    const user = await requireUser("FIELD_WORKER")

    return <AppShell user={user}>{children}</AppShell>
}
