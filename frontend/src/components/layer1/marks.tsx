import { Badge } from '@/components/ui/badge'

/**
 * Marks something as this project's rather than NYC's.
 *
 * Every Layer 1 surface carries it, in the one colour reserved for our layers,
 * so a demo — or a sceptical examiner — can see at a glance where the replica
 * ends and the additions begin. Without it an officer's name on a request would
 * read as if New York had recorded one.
 */
export function LayerMark({ layer = 1 }: { layer?: number }) {
    return (
        <Badge tone="new" title="Added by this project. NYC 311 has no equivalent.">
            Layer {layer} · ours
        </Badge>
    )
}

/**
 * A staff name, with the fact that nobody real stands behind it.
 *
 * NYC 311 records no case-worker identity, so every officer and supervisor here
 * is a synthetic account named for its post. The badge is not optional and is
 * not a tooltip-only affordance: a synthetic person presented as a real one is
 * the one thing this replica must never do.
 */
export function StaffName({ name, isSynthetic }: { name: string; isSynthetic: boolean }) {
    return (
        <span className="inline-flex flex-wrap items-center gap-2">
            <span>{name}</span>
            {isSynthetic && (
                <Badge
                    tone="new"
                    title="A synthetic account. NYC 311 records no case-worker identity, so no real person stands behind this name."
                >
                    synthetic
                </Badge>
            )}
        </span>
    )
}
