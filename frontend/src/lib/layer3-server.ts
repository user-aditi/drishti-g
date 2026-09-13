import { serverFetch } from './api'
import { toQuery } from './api-base'
import type { AuditPage, PeoplePage, PersonDetail, RiskModel, RiskUnitsPage, RoutingReport, SystemState } from '@/types/layer3'

/** Layer 3's server-side reads, kept apart from the layers below it. */

export const getRiskUnits = (params: { month?: string }) =>
    serverFetch<RiskUnitsPage>(`/risk/units${toQuery(params)}`)

export const getRiskModel = () => serverFetch<RiskModel>('/risk/model')

export const getRoutingReport = () => serverFetch<RoutingReport>('/routing/accuracy')

export const getAdminAudit = (params: { page?: number; action?: string }) =>
    serverFetch<AuditPage>(`/admin/audit${toQuery(params)}`)

export const getPeople = (params: {
    page?: number
    agencyId?: number
    orgUnitId?: number
    role?: string
    active?: string
    q?: string
}) => serverFetch<PeoplePage>(`/admin/people${toQuery(params)}`)

export const getSystemState = () => serverFetch<SystemState>('/admin/system')

export const getPerson = (id: number) => serverFetch<PersonDetail>(`/admin/people/${id}`)
