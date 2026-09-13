import { request } from './api-client'
import type { EscalatedRequest } from '@/types/layer2'

/** Layer 2's browser-side call. */
export const layer2Client = {
    escalate: (requestId: number, reason: string) =>
        request<EscalatedRequest>(`/requests/${requestId}/escalate`, {
            method: 'POST',
            body: { reason },
        }),
    acknowledge: (escalationId: number, note: string) =>
        request<EscalatedRequest>(`/escalations/${escalationId}/acknowledge`, {
            method: 'POST',
            body: { note },
        }),
}
