import type { Metadata } from "next"
import { requireUser } from "@/lib/auth"
import { serverFetchOr } from "@/lib/api"
import { PageHeader } from "@/components/shared/page-header"
import { StatStrip } from "@/components/shared/surface"
import type { DeskItem } from "@/types"
import { OfficerDeskClient } from "./client"

export const metadata: Metadata = { title: "My desk · DRISHTI-G" }
export const dynamic = "force-dynamic"

export default async function OfficerDeskPage() {
    const user = await requireUser("SECTION_OFFICER")
    const res = await serverFetchOr<{ items: DeskItem[]; total: number }>(
        "/officer/desk?scope=active",
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

    const needsAllotment = res.items.filter((i) => i.needsAllotment).length
    const overdue = res.items.filter((i) => i.isOverdue).length
    const escalated = res.items.filter((i) => i.escalationLevel > 0).length

    return (
        <div>
            <PageHeader title="My desk" eyebrow={description} />

            {res.items.length > 0 && (
                <StatStrip
                    className="mb-6"
                    stats={[
                        { label: "Open cases", value: res.items.length },
                        {
                            label: "Need a crew",
                            value: needsAllotment,
                            tone: needsAllotment > 0 ? "warning" : undefined,
                            hint: "Assigned to you, nobody on the job",
                        },
                        {
                            label: "Overdue",
                            value: overdue,
                            tone: overdue > 0 ? "danger" : "success",
                            hint: overdue > 0 ? "Escalating up the chain" : "Nothing past deadline",
                        },
                        {
                            label: "Escalated",
                            value: escalated,
                            tone: escalated > 0 ? "escalate" : undefined,
                            hint: "Already raised above you",
                        },
                    ]}
                />
            )}

            <OfficerDeskClient tasks={res.items} scope="active" />
        </div>
    )
}
