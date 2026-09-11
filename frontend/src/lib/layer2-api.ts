import { request } from './api-client'
import type { EscalatedRequest } from '@/types/layer2'

/** Layer 2's browser-side call. */
export const layer2Client = {
    escalate: (requestId: number, reason: string) =>
        request<EscalatedRequest>(`/requests/${requestId}/escalate`, {
            method: 'POST',
            body: { reason },
        }),
}
