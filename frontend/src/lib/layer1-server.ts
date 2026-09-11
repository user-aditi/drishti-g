import { serverFetch } from './api'
import { toQuery } from './api-base'
import type { Desk, Layer1Detail, OfficerSummary, UnassignedPage } from '@/types/layer1'

/**
 * Layer 1's server-side reads. A separate module from `api.ts` for the same
 * reason the backend keeps Layer 1 in its own routers: the baseline's client
 * should be readable without meeting a concept NYC does not have.
 */

export const getDesk = (params: { page?: number; scope?: 'open' | 'all' }) =>
    serverFetch<Desk>(`/officer/desk${toQuery(params)}`)

export const getOfficerRequest = (srNumber: string) =>
    serverFetch<Layer1Detail>(`/officer/requests/${encodeURIComponent(srNumber)}`)

export const getUnassigned = (params: { page?: number }) =>
    serverFetch<UnassignedPage>(`/supervisor/unassigned${toQuery(params)}`)

export const getOfficers = () => serverFetch<OfficerSummary[]>('/supervisor/officers')
