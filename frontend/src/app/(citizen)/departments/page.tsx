import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { PageHeader, SectionHeading } from '@/components/shared/page-header'
import type { Department } from '@/types'

export const metadata: Metadata = { title: 'Departments · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * The department registry, read-only for citizens.
 *
 * Coming-soon departments are shown rather than hidden: someone looking for
 * water supply deserves to know the wing exists and is not live yet, instead of
 * concluding the authority does not handle it and giving up.
 */
export default async function DepartmentsPage() {
    await requireUser()
    const departments = await serverFetchOr<Department[]>('/departments', [])

    const live = departments.filter((d) => d.status === 'ACTIVE')
    const planned = departments.filter((d) => d.status === 'COMING_SOON')

    return (
        <div>
            <PageHeader
                title="Departments"
                description="NOIDA Authority wings and what each one handles."
            />

            <SectionHeading
                title="Live now"
                description="Accepting complaints, staffed down to sector level."
            />
            <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {live.map((d) => (
                    <Card key={d.id} className="p-5">
                        <div className="flex items-start gap-3">
                            <span className="text-2xl" aria-hidden>
                                {d.icon}
                            </span>
                            <div className="min-w-0 flex-1">
                                <h3 className="font-semibold leading-tight">{d.name}</h3>
                                {d.nameHi && (
                                    <p className="text-sm text-[color:var(--muted-foreground)]">{d.nameHi}</p>
                                )}
                            </div>
                            <Badge variant="success">Live</Badge>
                        </div>

                        <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                            {d.description}
                        </p>

                        {d._count && (
                            <dl className="tnum mt-4 grid grid-cols-3 gap-2 border-t border-[color:var(--border)] pt-3 text-center">
                                <div>
                                    <dt className="text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)]">
                                        Issues
                                    </dt>
                                    <dd className="text-sm font-semibold">{d._count.categories}</dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)]">
                                        Staff
                                    </dt>
                                    <dd className="text-sm font-semibold">{d._count.postings}</dd>
                                </div>
                                <div>
                                    <dt className="text-[10px] uppercase tracking-wide text-[color:var(--muted-foreground)]">
                                        Complaints
                                    </dt>
                                    <dd className="text-sm font-semibold">{d._count.complaints}</dd>
                                </div>
                            </dl>
                        )}
                    </Card>
                ))}
            </div>

            <SectionHeading
                title="On the roadmap"
                description="Listed so nobody has to guess whether the authority handles it."
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {planned.map((d) => (
                    <Card key={d.id} className="border-dashed bg-[color:var(--muted)]/40 p-5">
                        <div className="flex items-start gap-3">
                            <span className="text-2xl opacity-50" aria-hidden>
                                {d.icon}
                            </span>
                            <div className="min-w-0 flex-1">
                                <h3 className="font-semibold leading-tight text-[color:var(--muted-foreground)]">
                                    {d.name}
                                </h3>
                                {d.nameHi && (
                                    <p className="text-sm text-[color:var(--muted-foreground)] opacity-70">
                                        {d.nameHi}
                                    </p>
                                )}
                            </div>
                            <Badge variant="neutral">Coming soon</Badge>
                        </div>

                        <p className="mt-3 text-sm leading-relaxed text-[color:var(--muted-foreground)]">
                            {d.description}
                        </p>

                        {d.roadmapNote && (
                            <p className="mt-3 rounded-lg bg-[color:var(--card)] px-3 py-2 text-xs leading-relaxed text-[color:var(--muted-foreground)]">
                                {d.roadmapNote}
                            </p>
                        )}
                    </Card>
                ))}
            </div>
        </div>
    )
}
