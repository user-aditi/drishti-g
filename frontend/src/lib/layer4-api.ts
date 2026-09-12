'use client'

import { ApiError } from './api-error'
import { BROWSER_API } from './api-base'
import { request } from './api-client'
import type { CrewProof, CrewSubmission, ProofView } from '@/types/layer4'

/**
 * Layer 4's browser-side calls.
 *
 * The upload does not go through `request()`: a photograph travels as multipart
 * form data, and setting a JSON content type on it would break the boundary the
 * browser generates. Everything else about it is the same — the session cookie
 * still travels, because an officer's decision needs it.
 */
async function upload<T>(path: string, form: FormData): Promise<T> {
    let res: Response
    try {
        res = await fetch(`${BROWSER_API}${path}`, { method: 'POST', credentials: 'include', body: form })
    } catch {
        throw new ApiError(0, 'Could not reach the service. Check that the API is running.')
    }
    if (!res.ok) {
        let parsed: { error?: string; message?: string } | null = null
        try {
            parsed = await res.json()
        } catch {
            // Non-JSON error body — fall back to the status.
        }
        throw new ApiError(res.status, parsed?.error ?? parsed?.message ?? `Upload failed (${res.status})`)
    }
    return (await res.json()) as T
}

export const layer4Client = {
    /** The verdict on a job, to whoever holds its code. */
    proof: (code: string) =>
        request<CrewProof>(`/work-orders/${encodeURIComponent(code)}/proof`),

    /** The crew's completion, with photographs. No session: the code is the credential. */
    completeWithPhotos: (code: string, photos: File[], note?: string) => {
        const form = new FormData()
        for (const photo of photos) form.append('photos', photo)
        if (note) form.append('note', note)
        return upload<CrewSubmission>(`/work-orders/${encodeURIComponent(code)}/complete`, form)
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
