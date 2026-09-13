/**
 * Taking photographs from a crew that has no account. Layer 4.
 *
 * Three at most. The storage rules — generated names, extensions from the
 * declared type, the size limit — are shared with filing and live in
 * `photos.ts`.
 */
import { acceptPhotos } from './photos.js'

export { storedPath, uploadDir } from './photos.js'

export const MAX_PHOTOS = 3

export const uploadProof = acceptPhotos({ prefix: 'proof', max: MAX_PHOTOS })
