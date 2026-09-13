import type { Metadata } from 'next'
import Link from 'next/link'
import { PageHeading, PageShell } from '@/components/shared/page-heading'
import { ErrorNotice } from '@/components/shared/notices'
import { ReferenceDate } from '@/components/shared/reference-date'
import { SlaFootnote } from '@/components/shared/sla-note'
import {
    EmptyRow,
    RegisterBody,
    RegisterFrame,
    RegisterHead,
    RegisterTable,
    Td,
    Th,
    Tr,
} from '@/components/shared/register'
import { EMPTY, formatCount, formatHours } from '@/lib/format'
import { getBoards, getHealth } from '@/lib/api'
import { messageFrom } from '@/lib/api-error'
import { auth } from '@/lib/auth'
import { AgencyFilter, agencyChoice } from '@/components/shared/agency-filter'
import type { Board } from '@/types'

export const metadata: Metadata = { title: 'Community boards' }
export const dynamic = 'force-dynamic'

/**
 * Brooklyn's eighteen community boards, by the numbers.
 *
 * A register rather than a dashboard: eighteen rows of the same five figures
 * exist to be compared down a column, and eighteen cards would make that the
 * one thing you cannot do.
 *
 * The middle column is a **median**, and that choice carries the screen. These
 * distributions are violently skewed — Street Light Condition closes at a median
 * of 139 hours and a 90th percentile of 1,881 — so a mean would report a number
 * no request in that board ever experienced, and would lurch every time one
 * streetlight sat open for two years.
 *
 * Public since Phase 11, like the API behind it: these are counts over NYC Open
 * Data, and a resident asking how their board compares is who they are for.
 */
export default async function BoardsPage({
    searchParams,
}: {
    searchParams: Record<string, string | string[] | undefined>
}) {
    const user = await auth()
    const { agencies, selected } = await agencyChoice(searchParams, user)

    let boards: Board[] = []
    let error: string | null = null

    try {
        boards = await getBoards(selected?.id)
    } catch (err) {
        error = messageFrom(err, 'The community boards could not be loaded.')
    }

    let referenceDate = new Date().toISOString()
    try {
        referenceDate = (await getHealth()).referenceDate
    } catch {
        // The figures still read; only the overdue column needs the date stated.
    }

    const borough = boards.reduce(
        (sum, board) => ({
            total: sum.total + board.total,
            open: sum.open + board.open,
            overdue: sum.overdue + board.overdue,
        }),
        { total: 0, open: 0, overdue: 0 },
    )

    return (
        <PageShell>
            <PageHeading
                title="Community boards"
                description="Brooklyn's eighteen community boards, with the volume, backlog and typical closing time behind each. Boards are the smallest area 311 attributes a request to."
            />

            <AgencyFilter path="/boards" agencies={agencies} selected={selected} />

            {error ? (
                <ErrorNotice title="Could not load the boards" message={error} />
            ) : (
                <>
                    <ReferenceDate referenceDate={referenceDate} />

                    <RegisterFrame>
                        <RegisterTable
                            caption={`Service requests by Brooklyn community board, ${selected ? selected.name : 'every agency'}`}
                        >
                            <RegisterHead>
                                <Th>Board</Th>
                                <Th align="right">Requests</Th>
                                <Th align="right">Open</Th>
                                <Th align="right">Overdue</Th>
                                <Th align="right">Median to close</Th>
                            </RegisterHead>
                            <RegisterBody>
                                {boards.length === 0 ? (
                                    <EmptyRow colSpan={5}>
                                        No boards have been seeded yet.
                                    </EmptyRow>
                                ) : (
                                    boards.map((board) => (
                                        <Tr key={board.id}>
                                            <Td>
                                                {/* The queue is the agent's; everyone else reads the row. */}
                                                {user?.role === 'AGENT' ? (
                                                    <Link
                                                        href={`/agency/queue?orgUnitId=${board.id}`}
                                                        className="text-brand underline underline-offset-2"
                                                    >
                                                        <span className="mono">{board.code}</span> {board.name}
                                                    </Link>
                                                ) : (
                                                    <>
                                                        <span className="mono">{board.code}</span> {board.name}
                                                    </>
                                                )}
                                            </Td>
                                            <Td align="right" mono>
                                                {formatCount(board.total)}
                                            </Td>
                                            <Td align="right" mono>
                                                {formatCount(board.open)}
                                            </Td>
                                            <Td
                                                align="right"
                                                mono
                                                className={board.overdue > 0 ? 'text-stop' : undefined}
                                            >
                                                {formatCount(board.overdue)}
                                            </Td>
                                            <Td align="right" mono>
                                                {board.medianResolutionHours === null
                                                    ? EMPTY
                                                    : formatHours(board.medianResolutionHours)}
                                            </Td>
                                        </Tr>
                                    ))
                                )}
                            </RegisterBody>
                        </RegisterTable>
                    </RegisterFrame>

                    <p className="text-[13.5px] text-ink-mid">
                        Borough total: {formatCount(borough.total)} requests,{' '}
                        {formatCount(borough.open)} still open,{' '}
                        {formatCount(borough.overdue)} past their derived deadline.
                    </p>

                    {/* The deadline behind "overdue" is this project's, not New
                        York's — the footnote is where that is said. */}
                    <SlaFootnote />
                </>
            )}
        </PageShell>
    )
}
