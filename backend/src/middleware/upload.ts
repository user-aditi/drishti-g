import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { env } from '../config/env.js'
import { badRequest } from '../utils/http.js'

const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR)
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true })

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
const MAX_BYTES = 8 * 1024 * 1024

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    // Random name, extension taken from the declared mimetype rather than the
    // client-supplied filename — an uploaded "photo.php" must not stay one.
    const ext = file.mimetype === 'image/png' ? '.png' : file.mimetype === 'image/webp' ? '.webp' : '.jpg'
    cb(null, `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`)
  },
})

export const uploadPhoto = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) {
      return cb(badRequest('Only JPEG, PNG, WebP or HEIC images can be uploaded'))
    }
    cb(null, true)
  },
}).single('photo')

/** Public URL for a stored upload. */
export function photoUrl(filename: string): string {
  return `${env.PUBLIC_URL}/${env.UPLOAD_DIR}/${filename}`
}

// ---------------------------------------------------------------------------
// Field proof
// ---------------------------------------------------------------------------

/**
 * What a street worker may send back from a job.
 *
 * Wider than a citizen's complaint photo on purpose: a lineman may film a
 * repaired junction, and a contractor may have a signed completion slip. The
 * cap is generous because the alternative — a worker on a patchy connection
 * failing an upload and giving up — costs more than the disk does.
 */
const PROOF_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/pdf',
])

const PROOF_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'application/pdf': '.pdf',
}

export type ProofKind = 'IMAGE' | 'VIDEO' | 'DOCUMENT'

export function proofKind(mimeType: string): ProofKind {
  if (mimeType.startsWith('video/')) return 'VIDEO'
  if (mimeType === 'application/pdf') return 'DOCUMENT'
  return 'IMAGE'
}

const proofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = PROOF_EXTENSIONS[file.mimetype] ?? '.bin'
    cb(null, `proof-${Date.now()}-${randomBytes(6).toString('hex')}${ext}`)
  },
})

/**
 * Two fields, not one.
 *
 * `files` is the proof of work. `selfie` is the optional photograph of the
 * person sending it, kept separate all the way down so the verification checks
 * can ignore it — a job must never be closeable with a picture of a face.
 */
export const uploadProof = multer({
  storage: proofStorage,
  limits: { fileSize: 32 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => {
    if (file.fieldname === 'selfie' && !file.mimetype.startsWith('image/')) {
      return cb(badRequest('A selfie has to be a photograph.'))
    }
    if (!PROOF_TYPES.has(file.mimetype)) {
      return cb(badRequest('Send a photo, a short video, or a PDF.'))
    }
    cb(null, true)
  },
}).fields([
  { name: 'files', maxCount: 5 },
  { name: 'selfie', maxCount: 1 },
])
