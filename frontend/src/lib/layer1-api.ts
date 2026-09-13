import { request } from './api-client'
import type { RequestStatus } from '@/types'
import type {
    IssuedWorkOrder,
    Layer1Detail,
    Layer1Request,
    PublicWorkOrder,
    WorkOrderQr,
} from '@/types/layer1'

/** Layer 1's browser-side calls. See `layer1-server.ts` for why this is separate. */
export const layer1Client = {
    /** Change a request's status as the officer who answers for it, or a supervisor. */
    setStatus: (requestId: number, status: RequestStatus, note?: string) =>
        request<Layer1Request>(`/officer/requests/${requestId}/status`, {
            method: 'PATCH',
            body: { status, ...(note ? { note } : {}) },
        }),

    issueWorkOrder: (requestId: number, instructions?: string) =>
        request<IssuedWorkOrder>('/work-orders', {
            method: 'POST',
            body: { requestId, ...(instructions ? { instructions } : {}) },
        }),

    /** Only the issuing officer gets an answer; everyone else gets a 404. */
    qr: (code: string) => request<WorkOrderQr>(`/work-orders/${encodeURIComponent(code)}/qr`),

    cancelWorkOrder: (code: string) =>
        request<{ ok: true }>(`/work-orders/${encodeURIComponent(code)}/cancel`, {
            method: 'POST',
            body: {},
        }),

    assign: (requestId: number, officerId: number) =>
        request<Layer1Request>(`/requests/${requestId}/assign`, {
            method: 'POST',
            body: { officerId },
        }),

    officerRequest: (srNumber: string) =>
        request<Layer1Detail>(`/officer/requests/${encodeURIComponent(srNumber)}`),

    /** No session: the code in the URL is the whole credential. */
    workOrder: (code: string) => request<PublicWorkOrder>(`/work-orders/${encodeURIComponent(code)}`),

    complete: (code: string, note?: string) =>
        request<{ ok: true; state: 'COMPLETED'; completedAt: string }>(
            `/work-orders/${encodeURIComponent(code)}/complete`,
            { method: 'POST', body: note ? { note } : {} },
        ),
}
