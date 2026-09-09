'use client'

import { Segmented } from '@/components/shared/controls'

/**
 * The console's controls now come from the shared set.
 *
 * These were the originals — every other screen grew its own copy of them —
 * so the shared versions are these, generalised. This file stays as the
 * console's door onto them so the fourteen registers importing it keep working.
 */
export { Toolbar, FilterChips, type ChipOption } from '@/components/shared/controls'

/**
 * Switch between the registers on one page.
 *
 * Zones, circles and sectors are three tables of one thing — the geography —
 * so they share a page and a heading rather than becoming three sidebar entries
 * that make the layer structure harder to see, not easier.
 */
export function RegisterTabs<T extends string>({
    tabs,
    value,
    onChange,
}: {
    tabs: { value: T; label: string; count?: number }[]
    value: T
    onChange: (v: T) => void
}) {
    return <Segmented options={tabs} value={value} onChange={onChange} />
}
