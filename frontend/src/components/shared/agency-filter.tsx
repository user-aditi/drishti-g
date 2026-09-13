import Link from 'next/link'
import { getTaxonomy } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { Agency, User } from '@/types'

/**
 * Which agency's work a public register shows.
 *
 * The board rollup and the map are public (decided in Phase 11): counts over
 * NYC Open Data, which New York publishes to anyone. The agency is a filter the
 * reader chooses, defaulting to their own when they work for one, rather than a
 * scope decided by who is asking — so the same link shows everyone the same page.
 */
export async function agencyChoice(
    searchParams: Record<string, string | string[] | undefined>,
    user: User | null,
): Promise<{ agencies: Agency[]; selected: Agency | null }> {
    let agencies: Agency[] = []
    try {
        const types = await getTaxonomy()
        const byId = new Map<number, Agency>()
        for (const type of types) if (type.agency) byId.set(type.agency.id, type.agency)
        agencies = [...byId.values()].sort((a, b) => a.code.localeCompare(b.code))
    } catch {
        // Without the list the page still works, unfiltered.
    }

    const raw = Array.isArray(searchParams.agency) ? searchParams.agency[0] : searchParams.agency
    const code = raw ?? user?.agency?.code ?? 'all'
    const selected = agencies.find((agency) => agency.code === code) ?? null
    return { agencies, selected }
}

export function AgencyFilter({
    path,
    agencies,
    selected,
}: {
    path: string
    agencies: Agency[]
    selected: Agency | null
}) {
    if (agencies.length === 0) return null
    const options = [{ code: 'all', label: 'Every agency' }, ...agencies.map((a) => ({ code: a.code, label: a.code }))]
    return (
        <nav aria-label="Filter by agency" className="flex flex-wrap gap-2 text-sm">
            {options.map((option) => {
                const current = (selected?.code ?? 'all') === option.code
                return (
                    <Link
                        key={option.code}
                        href={`${path}?agency=${option.code}`}
                        aria-current={current ? 'page' : undefined}
                        className={cn(
                            'rounded-[var(--radius)] border px-3 py-1',
                            current
                                ? 'border-brand bg-brand-soft text-brand-ink'
                                : 'border-line-strong text-ink-mid hover:bg-sunk',
                        )}
                    >
                        {option.label}
                    </Link>
                )
            })}
        </nav>
    )
}
