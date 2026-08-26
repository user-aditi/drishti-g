import { CardSkeleton } from "@/components/ui/skeleton"

export default function Loading() {
    return (
        <div className="space-y-4">
            <CardSkeleton rows={1} />
            <CardSkeleton rows={3} />
            <CardSkeleton rows={3} />
        </div>
    )
}
