import { serverFetch } from './api'
import { toQuery } from './api-base'
import type { EscalationsPage, RequestEscalations } from '@/types/layer2'

/** Layer 2's server-side reads, kept apart from the layers below it. */

export const getEscalations = (params: { level?: number; page?: number }) =>
    serverFetch<EscalationsPage>(`/escalations${toQuery(params)}`)

export const getRequestEscalations = (srNumber: string) =>
    serverFetch<RequestEscalations>(`/escalations/request/${encodeURIComponent(srNumber)}`)
