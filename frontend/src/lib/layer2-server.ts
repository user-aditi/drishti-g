import { serverFetch } from './api'
import { toQuery } from './api-base'
import type { EscalationsPage, RequestEscalations } from '@/types/layer2'

/** Layer 2's server-side reads, kept apart from the layers below it. */

export const getEscalations = ({ openOnly, ...params }: { level?: number; page?: number; openOnly?: boolean }) =>
    // Spelled out as a string: `toQuery` drops `false`, and the API's default is open only,
    // so a boolean here would silently turn "include resolved" back into "still open".
    serverFetch<EscalationsPage>(
        `/escalations${toQuery({ ...params, openOnly: openOnly === undefined ? undefined : String(openOnly) })}`,
    )

export const getRequestEscalations = (srNumber: string) =>
    serverFetch<RequestEscalations>(`/escalations/request/${encodeURIComponent(srNumber)}`)
