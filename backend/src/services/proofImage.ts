/**
 * What a photograph is, as far as the checks are concerned. Layer 4.
 *
 * Two identities per file. The SHA-256 answers "is this the same file", which
 * is defeated by re-saving it. The difference hash answers "is this the same
 * photograph", and survives re-encoding, resizing and light cropping — the ways
 * a crew would actually re-send an old picture: opening it in a gallery app and
 * sharing it again re-encodes it, so an exact hash never matches twice.
 *
 * The hash is deliberately the cheap, well-understood one. Each image is
 * reduced to nine by eight greyscale pixels and each pixel compared with its
 * right-hand neighbour, giving 64 bits that describe the coarse shape of the
 * image and ignore its colour, size and compression. What that costs is stated
 * in the measurement rather than assumed: two different potholes photographed
 * from a metre apart can hash close together, and `npm run layer4:measure`
 * reports how often, on real civic photographs, at the threshold that ships.
 */
import { createHash } from 'node:crypto'
import sharp from 'sharp'

/** Width of the reduced image; the extra column is what makes 8 comparisons. */
const HASH_W = 9
const HASH_H = 8

export interface ImageIdentity {
  sha256: string
  /** 16 hex characters, or null when the file could not be decoded. */
  dHash: string | null
  width: number | null
  height: number | null
}

export const sha256Of = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex')

/**
 * The difference hash of an image.
 *
 * `rotate()` with no argument applies the EXIF orientation, so a photograph
 * hashes the same whether the phone recorded the rotation in metadata or in
 * pixels. Failure returns null: an undecodable file must leave this check
 * inconclusive, never fail the crew.
 */
export async function dHashOf(bytes: Buffer): Promise<string | null> {
  try {
    const pixels = await sharp(bytes)
      .rotate()
      .greyscale()
      .resize(HASH_W, HASH_H, { fit: 'fill' })
      .raw()
      .toBuffer()
    if (pixels.length < HASH_W * HASH_H) return null

    let hex = ''
    for (let row = 0; row < HASH_H; row++) {
      let bits = 0
      for (let col = 0; col < HASH_W - 1; col++) {
        const here = pixels[row * HASH_W + col]!
        const next = pixels[row * HASH_W + col + 1]!
        bits = (bits << 1) | (here > next ? 1 : 0)
      }
      hex += bits.toString(16).padStart(2, '0')
    }
    return hex
  } catch {
    return null
  }
}

export async function identify(bytes: Buffer): Promise<ImageIdentity> {
  const sha256 = sha256Of(bytes)
  let width: number | null = null
  let height: number | null = null
  try {
    const meta = await sharp(bytes).metadata()
    width = meta.width ?? null
    height = meta.height ?? null
  } catch {
    // Not decodable: the dimensions are unknown and the hash will be null too.
  }
  return { sha256, dHash: await dHashOf(bytes), width, height }
}

const BITS = Array.from({ length: 256 }, (_, byte) => {
  let n = 0
  for (let b = byte; b > 0; b >>= 1) n += b & 1
  return n
})

/** How many of the 64 bits differ. Null for anything that is not two hashes. */
export function hamming(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b || a.length !== b.length) return null
  let distance = 0
  for (let i = 0; i < a.length; i += 2) {
    const x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16)
    if (Number.isNaN(x)) return null
    distance += BITS[x]!
  }
  return distance
}
