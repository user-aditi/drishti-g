import type { Metadata } from "next"
import { requireUser } from "@/lib/auth"
import { serverFetchOr } from "@/lib/api"
import { PageHeader } from "@/components/shared/page-header"
import { ComplaintMap } from "@/components/shared/complaint-map"
import { isAuthorityWide } from "@/lib/constants"
import type { Department, MapPin, SectorRisk } from "@/types"

export const metadata: Metadata = { title: "Map · DRISHTI-G" }
export const dynamic = "force-dynamic"

/**
 * Every officer's map, at whatever scope they are posted to.
 *
 * There used to be two of these — `/officer/map` for a Section Officer and
 * `/admin/map` for everyone above — rendering the same component over the same
 * two endpoints, and differing only in the sentence at the top. The API already
 * scopes both feeds to the caller's own subtree, so the second page was adding
 * a URL rather than a capability. One screen, and it reads who is looking at it.
 */
export default async function MapPage() {
    const user = await requireUser("SECTION_OFFICER")

    const [pins, risk, departments] = await Promise.all([
        serverFetchOr<{ items: MapPin[]; total?: number }>("/complaints/map?status=open", {
            items: [],
            total: 0,
        }),
        serverFetchOr<{ items: SectorRisk[] }>("/risk/sectors", { items: [] }),
        serverFetchOr<Department[]>("/departments", []),
    ])

    // A Section Officer covers ground they can walk; a General Manager covers a
    // department across the city. Saying "your jurisdiction" to the first is
    // needlessly grand, and saying "the sectors you cover" to the second is wrong.
    const scopeLine = isAuthorityWide(user.rank)
        ? "Complaints across the authority, over GRIE’s risk layer."
        : "Complaints across the ground you cover, over GRIE’s risk layer."

    return (
        <div>
            <PageHeader title="Map" description={scopeLine} />
            <ComplaintMap
                initialPins={pins.items}
                initialTotal={pins.total}
                sectors={risk.items}
                departments={departments.filter((d) => d.status === "ACTIVE")}
                title="Complaints and sector risk"
                description="Pins are complaints; the shaded circles are what GRIE thinks of each sector."
            />
        </div>
    )
}
