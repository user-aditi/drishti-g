import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { LayerMark } from '@/components/layer1/marks'
import { ErrorNotice } from '@/components/shared/notices'
import { Field, Figure, PageHeading, PageShell } from '@/components/shared/page-heading'
import {
    RegisterBody,
    RegisterFrame,
    RegisterHead,
    RegisterTable,
    Td,
    Th,
    Tr,
} from '@/components/shared/register'
import { Badge } from '@/components/ui/badge'
import { Panel, PanelBody, PanelHeader, PanelTitle } from '@/components/ui/card'
import { messageFrom } from '@/lib/api-error'
import { homeFor, requireUser } from '@/lib/auth'
import { formatCount, formatDateTime, humanise, relativeTime } from '@/lib/format'
import { getSystemState } from '@/lib/layer3-server'
import type { JobRun, SystemState } from '@/types/layer3'

export const metadata: Metadata = { title: 'System' }
export const dynamic = 'force-dynamic'

function uptime(seconds: number): string {
    const days = Math.floor(seconds / 86_400)
    const hours = Math.floor((seconds % 86_400) / 3_600)
    const minutes = Math.floor((seconds % 3_600) / 60)
    return days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`
}

/** Whether a sweep looks alive: it has run, recently enough for its interval, and its last run did not fail. */
function jobHealth(job: JobRun): { tone: 'done' | 'wait' | 'stop'; label: string } {
    if (job.lastError) return { tone: 'stop', label: 'Last run failed' }
    if (!job.lastFinishedAt) return { tone: 'wait', label: 'Not yet run' }
    const late = Date.now() - new Date(job.lastFinishedAt).getTime() > job.intervalMs * 3
    return late ? { tone: 'wait', label: 'Overdue' } : { tone: 'done', label: 'Running' }
}

/**
 * The running system, on one page.
 *
 * Each block answers a question that otherwise needs a terminal. Which day does
 * the system think it is? Which trained models did it actually load — or is it
 * quietly running without one? Are the sweeps alive, or did one die at boot? A
 * sweep that found nothing and a sweep that is not running look the same in a
 * log, and not here.
 */
export default async function SystemPage() {
    const user = await requireUser()
    if (user.role !== 'ADMIN') redirect(homeFor(user.role))

    let data: SystemState | null = null
    let error: string | null = null
    try {
        data = await getSystemState()
    } catch (err) {
        error = messageFrom(err, 'The system state could not be loaded.')
    }

    return (
        <PageShell>
            <PageHeading
                title="System"
                actions={<LayerMark layer={3} />}
                description="The state of the running API: its clock, the models it loaded, its background sweeps, the audit chain and who holds an account."
            />

            {error || !data ? (
                <ErrorNotice title="Could not load the system state" message={error ?? 'Unknown error'} />
            ) : (
                <>
                    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        <Figure
                            label="Status"
                            value={data.status === 'ok' ? 'OK' : 'Degraded'}
                            hint={data.postgres.ok ? 'Postgres answering' : data.postgres.detail}
                        />
                        <Figure label="Requests" value={formatCount(data.corpus.requests)} hint={`${formatCount(data.corpus.open)} open`} />
                        <Figure
                            label="Filed here"
                            value={formatCount(data.corpus.live)}
                            hint={`${formatCount(data.corpus.imported)} imported from NYC`}
                        />
                        <Figure label="Audit chain" value={formatCount(data.chain.length)} hint="entries" />
                    </div>

                    <Panel>
                        <PanelHeader>
                            <PanelTitle>Clock and process</PanelTitle>
                        </PanelHeader>
                        <PanelBody>
                            <dl>
                                <Field label="Reference date" mono>
                                    {formatDateTime(data.clock.referenceDate)}
                                </Field>
                                <Field label="Wall clock" mono>
                                    {formatDateTime(data.clock.wallClock)}
                                </Field>
                                <Field label="Which clock applies">{data.clock.rule}</Field>
                                <Field label="Environment" mono>
                                    {data.process.nodeEnv} · Node {data.process.node}
                                </Field>
                                <Field label="Up for" mono>
                                    {uptime(data.process.uptimeSeconds)} (since {formatDateTime(data.process.startedAt)})
                                </Field>
                            </dl>
                        </PanelBody>
                    </Panel>

                    <RegisterFrame>
                        <RegisterTable caption="Trained models this build executes">
                            <RegisterHead>
                                <Th>Model</Th>
                                <Th>File</Th>
                                <Th>Contract</Th>
                                <Th>Loaded version</Th>
                            </RegisterHead>
                            <RegisterBody>
                                {data.specs.map((spec) => (
                                    <Tr key={spec.file}>
                                        <Td>{spec.name}</Td>
                                        <Td mono>{spec.file}</Td>
                                        <Td mono>{spec.contract}</Td>
                                        <Td>
                                            {spec.loaded ? (
                                                <span className="mono">{spec.modelVersion}</span>
                                            ) : (
                                                <Badge tone="stop">Not loaded — running without it</Badge>
                                            )}
                                        </Td>
                                    </Tr>
                                ))}
                            </RegisterBody>
                        </RegisterTable>
                    </RegisterFrame>

                    <RegisterFrame>
                        <RegisterTable caption="Background sweeps in this process">
                            <RegisterHead>
                                <Th>Sweep</Th>
                                <Th>State</Th>
                                <Th align="right">Every</Th>
                                <Th>Last run</Th>
                                <Th>Last result</Th>
                                <Th align="right">Runs</Th>
                                <Th align="right">Failures</Th>
                            </RegisterHead>
                            <RegisterBody>
                                {data.jobs.length === 0 ? (
                                    <Tr>
                                        <Td colSpan={7} className="text-ink-mid">
                                            No sweeps are registered in this process. They start with the server
                                            and are off under test.
                                        </Td>
                                    </Tr>
                                ) : (
                                    data.jobs.map((job) => {
                                        const health = jobHealth(job)
                                        return (
                                            <Tr key={job.name}>
                                                <Td mono>{job.name}</Td>
                                                <Td>
                                                    <Badge tone={health.tone}>{health.label}</Badge>
                                                </Td>
                                                <Td align="right" mono>
                                                    {Math.round(job.intervalMs / 60_000)}m
                                                </Td>
                                                <Td className="whitespace-nowrap">
                                                    {job.lastFinishedAt
                                                        ? `${relativeTime(job.lastFinishedAt)} · ${job.lastDurationMs}ms`
                                                        : '—'}
                                                </Td>
                                                <Td className="text-sm">
                                                    {job.lastError ? (
                                                        <span className="text-stop">{job.lastError}</span>
                                                    ) : job.lastResult ? (
                                                        Object.entries(job.lastResult)
                                                            .map(([key, value]) => `${humanise(key.replace(/([a-z])([A-Z])/g, '$1_$2'))} ${formatCount(value)}`)
                                                            .join(' · ')
                                                    ) : (
                                                        '—'
                                                    )}
                                                </Td>
                                                <Td align="right" mono>
                                                    {formatCount(job.runs)}
                                                </Td>
                                                <Td align="right" mono>
                                                    {formatCount(job.failures)}
                                                </Td>
                                            </Tr>
                                        )
                                    })
                                )}
                            </RegisterBody>
                        </RegisterTable>
                    </RegisterFrame>

                    <div className="grid gap-6 md:grid-cols-2">
                        <Panel>
                            <PanelHeader>
                                <PanelTitle>Audit chain</PanelTitle>
                            </PanelHeader>
                            <PanelBody>
                                <dl>
                                    <Field label="Entries" mono>
                                        {formatCount(data.chain.length)}
                                    </Field>
                                    {data.chain.head && (
                                        <>
                                            <Field label="Latest" mono>
                                                #{data.chain.head.id} {data.chain.head.action},{' '}
                                                {formatDateTime(data.chain.head.createdAt)}
                                            </Field>
                                            <Field label="Head hash" mono>
                                                <span className="break-all">{data.chain.head.hash}</span>
                                            </Field>
                                        </>
                                    )}
                                </dl>
                                <p className="mt-3 text-sm text-ink-mid">
                                    Length is not proof. To walk the chain and check every link, use{' '}
                                    <Link href="/admin/audit" className="text-brand underline underline-offset-2">
                                        the audit page
                                    </Link>
                                    .
                                </p>
                            </PanelBody>
                        </Panel>

                        <RegisterFrame>
                            <RegisterTable caption="Accounts by role">
                                <RegisterHead>
                                    <Th>Role</Th>
                                    <Th align="right">Active</Th>
                                    <Th align="right">Deactivated</Th>
                                </RegisterHead>
                                <RegisterBody>
                                    {data.people.byRole.map((row) => (
                                        <Tr key={row.role}>
                                            <Td>{humanise(row.role)}</Td>
                                            <Td align="right" mono>
                                                {formatCount(row.active)}
                                            </Td>
                                            <Td align="right" mono>
                                                {formatCount(row.inactive)}
                                            </Td>
                                        </Tr>
                                    ))}
                                    <Tr>
                                        <Td>Active postings</Td>
                                        <Td align="right" mono>
                                            {formatCount(data.people.activePostings)}
                                        </Td>
                                        <Td align="right">—</Td>
                                    </Tr>
                                </RegisterBody>
                            </RegisterTable>
                        </RegisterFrame>
                    </div>
                </>
            )}
        </PageShell>
    )
}
