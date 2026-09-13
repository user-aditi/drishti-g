/**
 * Taking photographs from people who may have no account.
 *
 * Shared by every surface that accepts one: a resident attaching a picture of
 * the problem when they file, and (Layer 4) a crew sending pictures of the
 * finished job. Photographs only, a handful at most, and a generous size limit,
 * because the alternative — someone on a patchy connection failing an upload and
 * giving up — costs more than the disk does.
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

const MAX_BYTES = 12 * 1024 * 1024

/** Multer middleware taking up to `max` photographs from the `photos` field. */
export function acceptPhotos(options: { prefix: string; max: number }) {
  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadDir),
    filename: (_req, file, cb) =>
      cb(null, `${options.prefix}-${Date.now()}-${randomBytes(6).toString('hex')}${EXTENSIONS[file.mimetype] ?? '.bin'}`),
  })
  return multer({
    storage,
    limits: { fileSize: MAX_BYTES, files: options.max },
    fileFilter: (_req, file, cb) => {
      if (!(file.mimetype in EXTENSIONS)) {
        return cb(badRequest('Send a photograph — JPEG, PNG, WebP or HEIC.'))
      }
      cb(null, true)
    },
  }).array('photos', options.max)
}

/** Where a stored photograph lives on disk. Never built from user input. */
export const storedPath = (storedName: string): string => path.join(uploadDir, path.basename(storedName))
