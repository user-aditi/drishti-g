import type { Metadata } from 'next'
import { ArrowUp, Mail, Phone, UserRound } from 'lucide-react'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Panel, PanelHeader } from '@/components/shared/surface'
import { EmptyState, PageHeader, SectionHeading } from '@/components/shared/page-header'
import { RANK_STYLE } from '@/lib/constants'
import { initials } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CitizenContacts, Department } from '@/types'
import { NeedsHomeSector } from '../needs-home-sector'

export const metadata: Metadata = { title: 'Who to contact · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * The officer who answers for your street, by name.
 *
 * This is the page the rest of the portal exists to make possible. A resident
 * can file a complaint anywhere; what a municipal system almost never tells
 * them is *who is now holding it* and *who it goes to next if nothing happens*.
 * Field workers are left out deliberately — the safai karamchari sweeping the
 * lane is not the person accountable for the lane not being swept.
 *
 * The chain of command is a ranked list of people with the same four facts
 * about each, so it is drawn as a table: the resident reads down the order and
 * sees exactly how far a complaint can climb. It is rendered on the server —
 * four rows need no sorting, no searching and no JavaScript.
 */
export default async function ContactsPage() {
    await requireUser()

    const [contacts, departments] = await Promise.all([
        serverFetchOr<CitizenContacts>('/citizen/officers', {
            home: null,
            needsHomeSector: true,
            departments: [],
        }),
        serverFetchOr<Department[]>('/departments', []),
    ])

    if (contacts.needsHomeSector || !contacts.home) {
        return (
            <div>
                <PageHeader
                    title="Who to contact"
                    description="The officer responsible for your sector, and who your complaint reaches above them."
                />
                <NeedsHomeSector what="the officer who answers for your street" />
            </div>
        )
    }

    const planned = departments.filter((d) => d.status === 'COMING_SOON')

    return (
        <div>
            <PageHeader
                eyebrow={contacts.home.trail.map((t) => t.name).join(' · ')}
                title="Who to contact"
                description="Start with the officer named first. Everyone below them is who it reaches, in order, if nothing is done."
            />

            {contacts.departments.length === 0 ? (
                <EmptyState
                    icon={<UserRound className="h-6 w-6" />}
                    title="No officers are posted to your sector yet"
                    description="Complaints you file will still be recorded, and will be routed as soon as a posting is made."
                />
            ) : (
                <div className="space-y-5">
                    {contacts.departments.map(({ department, directHead, escalatesTo }) => {
                        // One ladder: the officer who holds it, then everyone it
                        // climbs to. Rendering the two as one table is the point
                        // — the resident is reading a single chain, not a person
                        // and then a separate list.
                        const chain = [
                            { officer: directHead, holds: true },
                            ...escalatesTo.map((officer) => ({ officer, holds: false })),
                        ]

                        return (
                            <Panel key={department.id} flush>
                                <PanelHeader
                                    sunken
                                    title={
                                        <span className="flex items-center gap-2">
                                            <span aria-hidden className="text-base">
                                                {department.icon}
                                            </span>
                                            {department.name}
                                        </span>
                                    }
                                    description={department.nameHi ?? undefined}
                                />

                                <div className="overflow-x-auto">
                                    <table className="w-full min-w-[560px] border-collapse text-sm">
                                        <caption className="sr-only">
                                            Chain of command for {department.name} in your sector
                                        </caption>
                                        <thead>
                                            <tr className="border-b border-[color:var(--border)]">
                                                <th scope="col" className="label-cap w-12 px-4 py-2.5 text-left">
                                                    #
                                                </th>
                                                <th scope="col" className="label-cap px-4 py-2.5 text-left">
                                                    Officer
                                                </th>
                                                <th scope="col" className="label-cap px-4 py-2.5 text-left">
                                                    Post
                                                </th>
                                                <th
                                                    scope="col"
                                                    className="label-cap hidden px-4 py-2.5 text-left sm:table-cell"
                                                >
                                                    Responsible for
                                                </th>
                                                <th scope="col" className="label-cap px-4 py-2.5 text-left">
                                                    Reach them
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-[color:var(--border)]">
                                            {chain.map(({ officer, holds }, index) => (
                                                <tr
                                                    key={officer.userId}
                                                    className={cn(
                                                        holds &&
                                                            'bg-[color:var(--primary-wash)] shadow-[inset_3px_0_0_0_var(--primary)]',
                                                    )}
                                                >
                                                    <td className="tnum px-4 py-3 align-top text-xs text-[color:var(--muted-foreground)]">
                                                        {index + 1}
                                                    </td>

                                                    <td className="px-4 py-3 align-top">
                                                        <div className="flex items-center gap-2.5">
                                                            <span
                                                                aria-hidden
                                                                className={cn(
                                                                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                                                                    holds
                                                                        ? 'bg-[color:var(--primary)] text-[color:var(--primary-foreground)]'
                                                                        : 'bg-[color:var(--muted)] text-[color:var(--muted-foreground)]',
                                                                )}
                                                            >
                                                                {initials(officer.fullName)}
                                                            </span>
                                                            <div className="min-w-0">
                                                                <div className="font-medium">
                                                                    {officer.fullName}
                                                                </div>
                                                                {holds ? (
                                                                    <div className="text-xs font-medium text-[color:var(--primary)]">
                                                                        Holds your complaint
                                                                    </div>
                                                                ) : (
                                                                    <div className="flex items-center gap-1 text-xs text-[color:var(--muted-foreground)]">
                                                                        <ArrowUp
                                                                            className="h-3 w-3"
                                                                            aria-hidden
                                                                        />
                                                                        If nothing is done
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>

                                                    <td className="px-4 py-3 align-top">
                                                        <Badge className={RANK_STYLE[officer.rank]}>
                                                            {officer.designationTitle}
                                                        </Badge>
                                                    </td>

                                                    <td className="hidden px-4 py-3 align-top text-xs text-[color:var(--muted-foreground)] sm:table-cell">
                                                        {officer.jurisdictionLabel}
                                                    </td>

                                                    <td className="px-4 py-3 align-top">
                                                        {holds ? (
                                                            <div className="flex flex-col gap-1 text-xs">
                                                                <a
                                                                    href={`mailto:${officer.email}`}
                                                                    className="inline-flex items-center gap-1.5 text-[color:var(--primary)] hover:underline"
                                                                >
                                                                    <Mail className="h-3.5 w-3.5" aria-hidden />
                                                                    {officer.email}
                                                                </a>
                                                                {officer.phone && (
                                                                    <a
                                                                        href={`tel:${officer.phone}`}
                                                                        className="inline-flex items-center gap-1.5 text-[color:var(--primary)] hover:underline"
                                                                    >
                                                                        <Phone
                                                                            className="h-3.5 w-3.5"
                                                                            aria-hidden
                                                                        />
                                                                        {officer.phone}
                                                                    </a>
                                                                )}
                                                            </div>
                                                        ) : (
                                                            <span className="text-xs text-[color:var(--subtle-foreground)]">
                                                                Reached automatically
                                                            </span>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>

                                {escalatesTo.length > 0 && (
                                    <p className="border-t border-[color:var(--border)] bg-[color:var(--sunken)] px-4 py-2.5 text-xs text-[color:var(--muted-foreground)]">
                                        Climbing happens automatically when a deadline passes — you do
                                        not have to chase it yourself.
                                    </p>
                                )}
                            </Panel>
                        )
                    })}
                </div>
            )}

            {planned.length > 0 && (
                <section className="mt-10">
                    <SectionHeading
                        title="Not yet accepting complaints"
                        description="These wings of the authority exist but are not live on DRISHTI-G yet. Listed so you know the authority handles them, rather than concluding it does not."
                    />
                    <Panel flush>
                        <table className="w-full border-collapse text-sm">
                            <thead>
                                <tr className="border-b border-[color:var(--border)] bg-[color:var(--sunken)]">
                                    <th scope="col" className="label-cap px-4 py-2.5 text-left">
                                        Department
                                    </th>
                                    <th scope="col" className="label-cap px-4 py-2.5 text-left">
                                        When it arrives
                                    </th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-[color:var(--border)]">
                                {planned.map((d) => (
                                    <tr key={d.id}>
                                        <td className="px-4 py-3">
                                            <span className="flex items-center gap-2 font-medium">
                                                <span aria-hidden>{d.icon}</span>
                                                {d.name}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-xs text-[color:var(--muted-foreground)]">
                                            {d.roadmapNote ?? 'Not scheduled yet.'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </Panel>
                </section>
            )}
        </div>
    )
}
