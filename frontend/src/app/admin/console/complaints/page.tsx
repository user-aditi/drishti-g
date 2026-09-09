import type { Metadata } from 'next'
import { serverFetchOr } from '@/lib/api'
import { Trail } from '@/components/console/detail'
import { PageHeader } from '@/components/shared/page-header'
import type {
    CategoryRow,
    ConsoleComplaint,
    Department,
    GeographyRows,
    GeographyTree,
    Paged,
} from '@/types'
import { ComplaintDeskClient } from './client'

export const metadata: Metadata = { title: 'Complaints · DRISHTI-G' }
export const dynamic = 'force-dynamic'

interface Filters {
    flag?: string
    sectorId?: string
    circleId?: string
    zoneId?: string
    departmentId?: string
}

export default async function ComplaintDeskPage({
    searchParams,
}: {
    searchParams?: Filters
}) {
    const params = new URLSearchParams({ page: '1', size: '500' })
    for (const key of ['flag', 'sectorId', 'circleId', 'zoneId', 'departmentId'] as const) {
        const value = searchParams?.[key]
        if (value) params.set(key, value)
    }

    const [complaints, departments, geography, geographyRows, categories] = await Promise.all([
        serverFetchOr<Paged<ConsoleComplaint>>(`/console/complaints?${params}`, {
            items: [],
            total: 0,
            page: 1,
            size: 500,
        }),
        serverFetchOr<Department[]>('/departments', []),
        serverFetchOr<GeographyTree[]>('/geography', []),
        serverFetchOr<GeographyRows>('/console/geography', {
            zones: [],
            circles: [],
            sectors: [],
        }),
        serverFetchOr<{ items: CategoryRow[] }>('/console/categories', { items: [] }),
    ])

    // Arriving here from a sector or department page, the trail should say which
    // one — the filter is the context, not a detail hidden in the query string.
    const scope = describeScope(searchParams, departments, geographyRows)

    return (
        <div>
            <Trail
                items={[{ label: 'Complaints', href: '/admin/console/complaints' }, ...scope.trail]}
            />
            <PageHeader
                title={scope.title}
                description={scope.description}
            />
            <ComplaintDeskClient
                complaints={complaints.items}
                total={complaints.total}
                departments={departments}
                geography={geography}
                categories={categories.items}
                filters={{
                    flag: searchParams?.flag ?? '',
                    scopeLabel: scope.chip,
                }}
            />
        </div>
    )
}

/** Turn the incoming filters into words, so the page says what it is showing. */
function describeScope(
    searchParams: Filters | undefined,
    departments: Department[],
    geography: GeographyRows,
): { title: string; description: string; chip: string | null; trail: { label: string }[] } {
    const generic = {
        title: 'Complaints',
        description:
            'Every complaint in the authority, unscoped. This is the only view that can see a complaint nobody owns — and the only place one can be handed to a named official.',
        chip: null,
        trail: [] as { label: string }[],
    }

    if (searchParams?.sectorId) {
        const sector = geography.sectors.find((s) => String(s.id) === searchParams.sectorId)
        if (!sector) return generic
        const label = `Sector ${sector.number}`
        return {
            title: `Complaints in ${label}`,
            description: `Everything reported in ${sector.name}, ${sector.circleName}.`,
            chip: label,
            trail: [{ label }],
        }
    }

    if (searchParams?.circleId) {
        const circle = geography.circles.find((c) => String(c.id) === searchParams.circleId)
        if (!circle) return generic
        return {
            title: `Complaints in ${circle.name}`,
            description: `Everything reported across the sectors of ${circle.name}, ${circle.zoneName}.`,
            chip: circle.name,
            trail: [{ label: circle.name }],
        }
    }

    if (searchParams?.zoneId) {
        const zone = geography.zones.find((z) => String(z.id) === searchParams.zoneId)
        if (!zone) return generic
        return {
            title: `Complaints in ${zone.name}`,
            description: `Everything reported across every sector of ${zone.name}.`,
            chip: zone.name,
            trail: [{ label: zone.name }],
        }
    }

    if (searchParams?.departmentId) {
        const department = departments.find((d) => String(d.id) === searchParams.departmentId)
        if (!department) return generic
        return {
            title: `Complaints routed to ${department.name}`,
            description: 'Everything GCCE has sent to this department, across the whole city.',
            chip: department.name,
            trail: [{ label: department.name }],
        }
    }

    return generic
}
