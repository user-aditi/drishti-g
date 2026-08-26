import type { Metadata } from "next"
import { requireUser } from "@/lib/auth"
import { serverFetchOr } from "@/lib/api"
import { PageHeader } from "@/components/shared/page-header"
import type { Job } from "@/types"
import { WorkerJobsClient } from "../client"

export const metadata: Metadata = { title: "Completed jobs · DRISHTI-G" }
export const dynamic = "force-dynamic"

export default async function WorkerDoneJobsPage() {
    await requireUser("FIELD_WORKER")
    const res = await serverFetchOr<{ items: Job[]; total: number }>("/worker/jobs?scope=done", {
        items: [],
        total: 0,
    })

    return (
        <div className="mx-auto max-w-2xl">
            <PageHeader
                title="Completed jobs"
                description="Work you have reported finished, and what your officer decided."
            />
            <WorkerJobsClient jobs={res.items} scope="done" />
        </div>
    )
}
