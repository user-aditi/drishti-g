import { request } from './api-client'
import type { ChainVerification, HandedOn, RecomputeResult } from '@/types/layer3'

/** Layer 3's browser-side calls. */
export const layer3Client = {
    recompute: () => request<RecomputeResult>('/risk/recompute', { method: 'POST' }),
    verifyChain: () => request<ChainVerification>('/admin/audit/verify'),
    movePosting: (userId: number, body: { agencyId: number; orgUnitId: number; reason: string }) =>
        request<{ ok: true; requests: HandedOn | null }>(`/admin/people/${userId}/posting`, { method: 'POST', body }),
    setActive: (userId: number, body: { active: boolean; reason: string }) =>
        request<{ ok: true; requests: HandedOn | null }>(`/admin/people/${userId}/active`, { method: 'POST', body }),
}
