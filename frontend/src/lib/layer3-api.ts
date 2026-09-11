import { request } from './api-client'
import type { ChainVerification, RecomputeResult } from '@/types/layer3'

/** Layer 3's browser-side calls. */
export const layer3Client = {
    recompute: () => request<RecomputeResult>('/risk/recompute', { method: 'POST' }),
    verifyChain: () => request<ChainVerification>('/admin/audit/verify'),
}
