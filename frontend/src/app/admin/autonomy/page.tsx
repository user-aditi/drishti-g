import type { Metadata } from 'next'
import { requireUser } from '@/lib/auth'
import { serverFetchOr } from '@/lib/api'
import { PageHeader } from '@/components/shared/page-header'
import type { AutonomyConsole } from '@/types'
import { AutonomyClient } from './client'

export const metadata: Metadata = { title: 'Autonomy gate · DRISHTI-G' }
export const dynamic = 'force-dynamic'

/**
 * What the system would do on its own, and why it will not.
 *
 * This screen was specified around coverage over time and an override rate.
 * Neither exists, because the gate automates nothing — and that is the finding
 * rather than a gap. The calibration looked for a confidence level at which each
 * class of action could be taken unattended within a stated error tolerance, and
 * found one only for a class whose sole member is "this case is over", which is
 * a prediction rather than an action.
 *
 * So the screen shows three things instead, and each earns its place.
 *
 * The thresholds, with what they measured, so the setting is arguable rather
 * than mysterious. The review queue, ordered by how uncertain the system is
 * rather than by age — the opposite of every other register here, because its
 * job is to put the least-understood cases in front of a person. And the split
 * by proposed action, which is where the most useful thing the gate produces
 * turned up: the complaints whose own history says they look finished.
 */
export default async function AutonomyPage() {
    await requireUser('SUPER_ADMIN')

    const data = await serverFetchOr<AutonomyConsole>('/console/autonomy', {
        spec: null,
        total: 0,
        queue: [],
        byAction: [],
    })

    return (
        <div>
            <PageHeader
                title="Autonomy gate"
                description="What the system would do without a person, how sure it is, and why it holds back."
            />
            <AutonomyClient data={data} />
        </div>
    )
}
