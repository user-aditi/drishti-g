/**
 * Tiny synthetic photographs, so field submissions are real uploads.
 *
 * The crew surface does not just accept a note. A submission is scored by
 * `services/verification.ts` — was a photograph attached, is it a file nobody
 * has used before, does it carry EXIF, does its GPS land near the complaint —
 * and anything under 35 is rejected outright, which sends the job back rather
 * than moving the complaint to AWAITING_VERIFICATION. A simulator that posts
 * notes therefore never advances a single case past "in progress", and every
 * verification the officer would have done silently does not happen.
 *
 * So the simulator uploads actual image bytes. They are 8x8 PNGs built here
 * rather than fixtures on disk, for one reason that matters: **the content hash
 * must differ every time.** The proof checks specifically look for a file that
 * has been submitted against another job, because reusing yesterday's
 * photograph is the obvious way to fake completed work. One fixture reused
 * across five thousand submissions would trip that check on every case after
 * the first, and the run would look like mass fraud.
 *
 * These carry no EXIF and no GPS, so those checks score zero or partial credit
 * and submissions land in the 40-60 band: accepted, but visibly weaker proof
 * than a real photograph from a real phone. That is the honest outcome, and it
 * exercises the reviewing path rather than waving everything through.
 */
import { createHash } from 'node:crypto'
import { deflateSync } from 'node:zlib'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** CRC-32, as PNG defines it. Table built once on first use. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = -1
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/**
 * An 8x8 RGB PNG whose pixels are derived from `seed`.
 *
 * Deterministic in the seed, so a run with the same `--seed` uploads the same
 * bytes and the whole simulation stays reproducible down to the file hashes.
 */
export function syntheticPhoto(seed: number): Buffer {
  const size = 8
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour
  // 10, 11, 12 stay zero: deflate, adaptive filtering, no interlace.

  // One filter byte per scanline, then RGB triples.
  const raw = Buffer.alloc(size * (1 + size * 3))
  let offset = 0
  let state = (seed * 2654435761) >>> 0
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0 // filter: none
    for (let x = 0; x < size * 3; x++) {
      state = (state * 1664525 + 1013904223) >>> 0
      raw[offset++] = (state >>> 16) & 0xff
    }
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** Sanity check used by the simulator's own startup, so a broken encoder fails loudly. */
export function photoFingerprint(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 12)
}
