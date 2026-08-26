import type { Metadata } from "next"
import { requireUser } from "@/lib/auth"
import { serverFetchOr } from "@/lib/api"
import { PageHeader } from "@/components/shared/page-header"
import type { DeskItem } from "@/types"
import { OfficerDeskClient } from "../desk/client"

export const metadata: Metadata = { title: "Completed · DRISHTI-G" }
export const dynamic = "force-dynamic"

export default async function OfficerDonePage() {
    const user = await requireUser("SECTION_OFFICER")
    const res = await serverFetchOr<{ items: DeskItem[]; total: number }>(
        "/officer/desk?scope=done",
        { items: [], total: 0 },
    )

    const posting = user.primaryPosting
    const description = posting
        ? [
              posting.designationTitle,
              posting.sector && `Sector ${posting.sector.number}`,
              posting.department?.name,
          ]
              .filter(Boolean)
              .join(" · ")
        : undefined

    return (
        <div>
            <PageHeader title="Completed work" description={description} />


            <OfficerDeskClient tasks={res.items} scope="done" />
        </div>
    )
}
