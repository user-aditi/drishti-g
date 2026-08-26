import type { Metadata } from "next"
import { ArrowUp, Inbox, TriangleAlert, UserPlus } from "lucide-react"
import { requireUser } from "@/lib/auth"
import { serverFetchOr } from "@/lib/api"
import { PageHeader } from "@/components/shared/page-header"
import { StatTile } from "@/components/shared/stat-tile"
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
            <PageHeader title="My desk" description={description} />

            {res.items.length > 0 && (
                <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    <StatTile
                        label="Open cases"
                        value={res.items.length}
                        icon={<Inbox className="h-6 w-6" />}
                    />
                    <StatTile
                        label="Need a crew"
                        value={needsAllotment}
                        tone={needsAllotment > 0 ? "warning" : "default"}
                        hint="Assigned to you, nobody on the job"
                        icon={<UserPlus className="h-6 w-6" />}
                    />
                    <StatTile
                        label="Overdue"
                        value={overdue}
                        tone={overdue > 0 ? "danger" : "success"}
                        hint={overdue > 0 ? "Escalating up the chain" : "Nothing past deadline"}
                        icon={<TriangleAlert className="h-6 w-6" />}
                    />
                    <StatTile
                        label="Escalated"
                        value={escalated}
                        tone={escalated > 0 ? "purple" : "default"}
                        hint="Already raised above you"
                        icon={<ArrowUp className="h-6 w-6" />}
                    />
                </div>
            )}


            <OfficerDeskClient tasks={res.items} scope="active" />
        </div>
    )
}
