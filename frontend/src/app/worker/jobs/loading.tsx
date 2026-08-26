import { CardSkeleton } from "@/components/ui/skeleton"

export default function Loading() {
    return (
        <div className="mx-auto max-w-2xl space-y-4">
            <CardSkeleton rows={3} />
            <CardSkeleton rows={3} />
        </div>
    )
}
