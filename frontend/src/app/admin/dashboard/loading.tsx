import { CardSkeleton } from "@/components/ui/skeleton"

export default function Loading() {
    return (
        <div className="space-y-5">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => (
                    <CardSkeleton key={i} rows={1} />
                ))}
            </div>
            <CardSkeleton rows={5} />
        </div>
    )
}
