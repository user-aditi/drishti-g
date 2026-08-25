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
