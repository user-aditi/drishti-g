'use client'

import { BROWSER_API } from './api-base'
import { request } from './api-client'
import { uploadForm, type UploadProgress } from './upload'
import type { CrewProof, CrewSubmission, ProofView } from '@/types/layer4'

/**
 * Layer 4's browser-side calls.
 *
 * The crew's upload goes through `uploadForm`, which reports progress: a
 * photograph travels as multipart form data, and on mobile data the crew needs
 * to see it moving. The session cookie still travels, because an officer's
 * decision needs it.
 */
export const layer4Client = {
    /** The verdict on a job, to whoever holds its code. */
    proof: (code: string) =>
        request<CrewProof>(`/work-orders/${encodeURIComponent(code)}/proof`),

    /** The crew's completion, with photographs. No session: the code is the credential. */
    completeWithPhotos: (
        code: string,
        photos: File[],
        note?: string,
        onProgress?: (progress: UploadProgress) => void,
    ) => {
        const form = new FormData()
        for (const photo of photos) form.append('photos', photo)
        if (note) form.append('note', note)
        return uploadForm<CrewSubmission>(`${BROWSER_API}/work-orders/${encodeURIComponent(code)}/complete`, form, {
            onProgress,
        })
    },

    /** The resident's answer. It outranks every automated check. */
    citizenVerdict: (workOrderId: number, confirmed: boolean) =>
        request<ProofView>(`/proof/${workOrderId}/citizen`, { method: 'POST', body: { confirmed } }),

    /** The officer's decision, when it comes to that. */
    decide: (workOrderId: number, accept: boolean, note?: string) =>
        request<{ ok: true; outcome: string }>(`/proof/${workOrderId}/decide`, {
            method: 'POST',
            body: { accept, ...(note ? { note } : {}) },
        }),
}
