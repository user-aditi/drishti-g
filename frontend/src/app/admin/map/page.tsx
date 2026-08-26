import type { Metadata } from "next"
import { requireUser } from "@/lib/auth"
import { serverFetchOr } from "@/lib/api"
import { PageHeader } from "@/components/shared/page-header"
import { ComplaintMap } from "@/components/shared/complaint-map"
import type { Department, MapPin, SectorRisk } from "@/types"

export const metadata: Metadata = { title: "Map · DRISHTI-G" }
export const dynamic = "force-dynamic"

export default async function AdminMapPage() {
    await requireUser("CIRCLE_OFFICER")

    const [pins, risk, departments] = await Promise.all([
        serverFetchOr<{ items: MapPin[] }>("/complaints/map?status=open", { items: [] }),
        serverFetchOr<{ items: SectorRisk[] }>("/risk/sectors", { items: [] }),
        serverFetchOr<Department[]>("/departments", []),
    ])

    return (
        <div>
            <PageHeader title="Map" description="Complaints across your jurisdiction, over GRIE’s sector risk layer." />
            <ComplaintMap
                initialPins={pins.items}
                sectors={risk.items}
                departments={departments.filter((d) => d.status === "ACTIVE")}
                title="Complaints and sector risk"
                description="Pins are complaints; the shaded circles are what GRIE thinks of each sector."
            />
        </div>
    )
}
