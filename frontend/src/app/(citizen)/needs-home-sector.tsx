import Link from 'next/link'
import { MapPin } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Shown when a resident has not told us where they live.
 *
 * Every citizen page is scoped to a sector, so without one they would otherwise
 * meet an empty list and conclude the feature is broken. Named as a thing they
 * can fix in one click, not as an error.
 */
export function NeedsHomeSector({ what }: { what: string }) {
    return (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-[color:var(--input)] bg-[color:var(--card)]/60 px-6 py-14 text-center">
            <MapPin className="mb-4 h-9 w-9 text-[color:var(--muted-foreground)]" aria-hidden />
            <h2 className="text-sm font-semibold">Tell us which sector you live in</h2>
            <p className="mt-1 max-w-sm text-sm text-[color:var(--muted-foreground)]">
                We use it to show you {what}, and to work out which officer answers for your street.
            </p>
            <Button asChild className="mt-5">
                <Link href="/profile">Set my sector</Link>
            </Button>
        </div>
    )
}
