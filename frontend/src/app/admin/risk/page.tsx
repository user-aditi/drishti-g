import type { Metadata } from "next"
import { requireUser } from "@/lib/auth"
import { serverFetchOr } from "@/lib/api"
import { PageHeader } from "@/components/shared/page-header"
import { isSeniorOfficer } from "@/lib/constants"
import type { RiskFlag } from "@/types"
import { RiskQueueClient } from "./client"

export const metadata: Metadata = { title: "Risk queue · DRISHTI-G" }
export const dynamic = "force-dynamic"

export default async function RiskQueuePage() {
    const user = await requireUser("SECTION_OFFICER")
    const queue = await serverFetchOr<{ items: RiskFlag[]; total: number; threshold: number }>(
        "/risk/queue",
        { items: [], total: 0, threshold: 60 },
    )

    return (
        <div>
            <PageHeader
                title="Risk review queue"
                description={`GRIE flags any sector, circle, zone, department, project or contractor scoring ${queue.threshold} or above — and always shows its reasoning.`}
            />
            <RiskQueueClient
                flags={queue.items}
                threshold={queue.threshold}
                canAct={isSeniorOfficer(user.rank)}
            />
        </div>
    )
}
