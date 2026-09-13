'use client'

import { useEffect, useState } from 'react'
import { apiClient } from '@/lib/api-client'
import { BROWSER_API } from '@/lib/api-base'
import { ApiError } from '@/lib/api-error'
import type { RequestPhotoMeta } from '@/types'

/**
 * The photographs a resident attached when they reported the problem.
 *
 * Not public: a picture of a street can hold a face or a number plate. The API
 * decides who may see them — the reporter, and the agency handling the request —
 * and this renders whatever it is allowed to. Asked from the browser, so the
 * session travels and nothing about who is looking has to be guessed on the
 * server.
 *
 * For anyone else it says only how many there are, when `count` is given.
 */
export function RequestPhotos({
    srNumber,
    title = 'Photographs of the problem',
    count,
    compact = false,
}: {
    srNumber: string
    title?: string
    /** Shown to a reader who may not see them, so they know photographs exist. */
    count?: number
    compact?: boolean
}) {
    const [photos, setPhotos] = useState<RequestPhotoMeta[] | null>(null)
    const [hidden, setHidden] = useState(false)

    useEffect(() => {
        let live = true
        apiClient
            .photos(srNumber)
            .then((result) => live && setPhotos(result.photos))
            .catch((err) => {
                if (live && err instanceof ApiError && (err.status === 401 || err.status === 403)) setHidden(true)
            })
        return () => {
            live = false
        }
    }, [srNumber])

    if (hidden) {
        return count ? (
            <p className="text-sm text-ink-mid">
                {count === 1 ? 'A photograph was' : `${count} photographs were`} attached when this was reported.
                Only the person who reported it and the agency can see {count === 1 ? 'it' : 'them'}.
            </p>
        ) : null
    }
    if (!photos || photos.length === 0) return null

    return (
        <figure className="flex flex-col gap-2">
            <figcaption className={compact ? 'text-sm text-ink-mid' : 'label-cap'}>{title}</figcaption>
            <div className="flex flex-wrap gap-3">
                {photos.map((photo, i) => (
                    <a
                        key={photo.id}
                        href={`${BROWSER_API}/requests/${encodeURIComponent(srNumber)}/photos/${photo.id}`}
                        target="_blank"
                        rel="noreferrer"
                    >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                            src={`${BROWSER_API}/requests/${encodeURIComponent(srNumber)}/photos/${photo.id}`}
                            crossOrigin="use-credentials"
                            alt={`Photograph ${i + 1} attached when ${srNumber} was reported`}
                            className={`${compact ? 'h-32' : 'h-44'} w-auto rounded-[var(--radius)] border border-line object-cover`}
                        />
                    </a>
                ))}
            </div>
        </figure>
    )
}
