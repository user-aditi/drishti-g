import type { Metadata } from "next"
import { requireUser } from "@/lib/auth"
import { serverFetchOr } from "@/lib/api"
import { Card } from "@/components/ui/card"
import { PageHeader } from "@/components/shared/page-header"
import type { Job } from "@/types"
import { WorkerJobsClient } from "./client"

export const metadata: Metadata = { title: "My jobs · DRISHTI-G" }
export const dynamic = "force-dynamic"

export default async function WorkerJobsPage() {
    const user = await requireUser("FIELD_WORKER")
    const res = await serverFetchOr<{ items: Job[]; total: number }>("/worker/jobs?scope=active", {
        items: [],
        total: 0,
    })

    const posting = user.primaryPosting
    const overdue = res.items.filter((j) => j.isOverdue).length

    return (
        <div className="mx-auto max-w-2xl">
            <PageHeader
                title="My jobs"
                description={
                    posting
                        ? [posting.designationTitle, posting.sector && `Sector ${posting.sector.number}`]
                              .filter(Boolean)
                              .join(" · ")
                        : undefined
                }
            />

            {res.items.length > 0 && (
                <div className="mb-5 flex gap-3">
                    <Card className="flex-1 px-4 py-3">
                        <p className="text-xs font-medium uppercase tracking-wide text-[color:var(--muted-foreground)]">
                            Jobs today
                        </p>
                        <p className="tnum mt-1 text-2xl font-bold">{res.items.length}</p>
                    </Card>
                    {overdue > 0 && (
                        <Card className="flex-1 border-red-200 bg-red-50 px-4 py-3">
                            <p className="text-xs font-medium uppercase tracking-wide text-red-600">Overdue</p>
                            <p className="tnum mt-1 text-2xl font-bold text-red-700">{overdue}</p>
                        </Card>
                    )}
                </div>
            )}

            <WorkerJobsClient jobs={res.items} scope="active" />
        </div>
    )
}
