/**
 * Taking photographs from a crew that has no account. Layer 4.
 *
 * Adapted from the previous system's upload middleware, narrowed to what this
 * layer needs: photographs only, three at most, and a generous size limit
 * because the alternative — somebody on a patchy connection failing an upload
 * and giving up — costs more than the disk does.
 *
 * The stored name is always generated here, and its extension comes from the
 * declared type rather than from the name the uploader sent: an uploaded
 * "photo.php" must not stay one.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import multer from 'multer'
import { env } from '../config/env.js'
import { badRequest } from '../utils/http.js'

export const uploadDir = path.resolve(process.cwd(), env.UPLOAD_DIR)
if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true })

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
}

export const MAX_PHOTOS = 3
const MAX_BYTES = 12 * 1024 * 1024

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) =>
    cb(null, `proof-${Date.now()}-${randomBytes(6).toString('hex')}${EXTENSIONS[file.mimetype] ?? '.bin'}`),
})

export const uploadProof = multer({
  storage,
  limits: { fileSize: MAX_BYTES, files: MAX_PHOTOS },
  fileFilter: (_req, file, cb) => {
    if (!(file.mimetype in EXTENSIONS)) {
      return cb(badRequest('Send a photograph — JPEG, PNG, WebP or HEIC.'))
    }
    cb(null, true)
  },
}).array('photos', MAX_PHOTOS)

/** Where a stored photograph lives on disk. Never built from user input. */
export const storedPath = (storedName: string): string => path.join(uploadDir, path.basename(storedName))
