import type { Metadata } from "next"
import { MapPin } from "lucide-react"
import { requireUser } from "@/lib/auth"
import { serverFetchOr } from "@/lib/api"
import { EmptyState, PageHeader } from "@/components/shared/page-header"
import type { SectorRisk } from "@/types"
import { SectorRiskClient } from "./client"

export const metadata: Metadata = { title: "Sector risk · DRISHTI-G" }
export const dynamic = "force-dynamic"

export default async function SectorRiskPage() {
    await requireUser("SECTION_OFFICER")
    const res = await serverFetchOr<{ items: SectorRisk[]; threshold: number }>("/risk/sectors", {
        items: [],
        threshold: 60,
    })

    // Riskiest first: this page exists to answer "where is the problem?"
    const sectors = [...res.items].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))

    return (
        <div>
            <PageHeader
                title="Sector risk"
                description="Every sector scored on missed deadlines, repeat complaints, escalations, open load and speed."
            />
            {sectors.length === 0 ? (
                <EmptyState
                    icon={<MapPin className="h-10 w-10" />}
                    title="No sectors scored yet"
                    description="Run a recompute from the risk queue to generate scores."
                />
            ) : (
                <SectorRiskClient sectors={sectors} />
            )}
        </div>
    )
}
