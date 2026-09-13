'use client'

import { ApiError } from './api-error'

export interface UploadProgress {
    loaded: number
    total: number
}

/**
 * Send a multipart form, reporting how much of it has gone.
 *
 * `fetch` cannot report upload progress, and a crew on a street corner with one
 * bar of signal, watching a button that says "Sending…" for forty seconds, has
 * no way to tell a slow upload from a dead one — so they press it again, or give
 * up. XMLHttpRequest can, so uploads go through here.
 *
 * The files are sent exactly as chosen. Nothing is resized or re-encoded in the
 * browser, however tempting on mobile data: re-encoding strips the EXIF capture
 * time and position that two of Layer 4's checks read, and would turn honest
 * photographs into ones those checks cannot vouch for.
 *
 * A dropped connection rejects with status 0, distinct from a refusal, so the
 * caller can keep the photographs and offer to try again.
 */
export function uploadForm<T>(
    url: string,
    form: FormData,
    options: { onProgress?: (progress: UploadProgress) => void; timeoutMs?: number } = {},
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const xhr = new XMLHttpRequest()
        xhr.open('POST', url)
        xhr.withCredentials = true
        xhr.timeout = options.timeoutMs ?? 180_000
        xhr.responseType = 'text'

        if (options.onProgress) {
            const report = options.onProgress
            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) report({ loaded: event.loaded, total: event.total })
            }
        }

        xhr.onload = () => {
            let body: unknown = null
            try {
                body = xhr.responseText ? JSON.parse(xhr.responseText) : null
            } catch {
                body = null
            }
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve(body as T)
                return
            }
            const parsed = body as { error?: string; message?: string } | null
            reject(new ApiError(xhr.status, parsed?.error ?? parsed?.message ?? `Upload failed (${xhr.status})`))
        }
        xhr.onerror = () =>
            reject(new ApiError(0, 'The connection dropped before the upload finished.'))
        xhr.ontimeout = () =>
            reject(new ApiError(0, 'The upload took too long and was stopped — the signal may be too weak.'))

        xhr.send(form)
    })
}

/** Megabytes, to one decimal place — what a crew on mobile data needs to know. */
export const megabytes = (bytes: number) => `${(bytes / 1_048_576).toFixed(1)} MB`
