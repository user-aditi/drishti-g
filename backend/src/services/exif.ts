/**
 * A minimal JPEG EXIF reader.
 *
 * Only three tags matter to this system: when the photograph was taken, and
 * where. Those are what let the pipeline tell a picture shot at the site this
 * morning from one pulled off a phone's camera roll, without anybody looking at
 * it. Pulling in a full EXIF library for three tags would be a poor trade, so
 * this parses them directly.
 *
 * Everything is best-effort: a phone that strips EXIF, a re-encoded upload, a
 * PNG — all return nulls, and the checks that depend on them simply do not
 * fire rather than failing the worker.
 */

/** Tag ids in the EXIF/GPS IFDs we care about. */
const TAG_DATETIME_ORIGINAL = 0x9003
const TAG_EXIF_IFD_POINTER = 0x8769
const TAG_GPS_IFD_POINTER = 0x8825
const TAG_GPS_LAT_REF = 0x0001
const TAG_GPS_LAT = 0x0002
const TAG_GPS_LON_REF = 0x0003
const TAG_GPS_LON = 0x0004

export interface ExifData {
  capturedAt: Date | null
  latitude: number | null
  longitude: number | null
}

const EMPTY: ExifData = { capturedAt: null, latitude: null, longitude: null }

/** Locate the TIFF header inside the APP1 segment of a JPEG. */
function findTiffOffset(buf: Buffer): number | null {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null

  let offset = 2
  while (offset + 4 <= buf.length) {
    if (buf[offset] !== 0xff) return null
    const marker = buf[offset + 1]!
    const size = buf.readUInt16BE(offset + 2)

    if (marker === 0xe1) {
      // APP1: "Exif\0\0" then the TIFF header.
      const start = offset + 4
      if (buf.toString('ascii', start, start + 4) === 'Exif') return start + 6
      return null
    }

    // Start of scan: image data follows, so there is no more metadata.
    if (marker === 0xda) return null
    offset += 2 + size
  }
  return null
}

interface Reader {
  u16: (at: number) => number
  u32: (at: number) => number
}

/** One rational (numerator/denominator pair) at a byte offset. */
function rational(read: Reader, at: number): number {
  const numerator = read.u32(at)
  const denominator = read.u32(at + 4)
  return denominator === 0 ? 0 : numerator / denominator
}

/** Degrees/minutes/seconds as three rationals, to decimal degrees. */
function dmsToDecimal(read: Reader, at: number): number {
  return rational(read, at) + rational(read, at + 8) / 60 + rational(read, at + 16) / 3600
}

/** "2026:08:26 14:31:05" — EXIF's own format, which Date cannot parse. */
function parseExifDate(value: string): Date | null {
  const match = value.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/)
  if (!match) return null
  const [, y, mo, d, h, mi, sec] = match
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(sec),
  )
  return Number.isNaN(date.getTime()) ? null : date
}

export function readExif(buf: Buffer): ExifData {
  try {
    const tiff = findTiffOffset(buf)
    if (tiff == null || tiff + 8 > buf.length) return EMPTY

    const endian = buf.toString('ascii', tiff, tiff + 2)
    if (endian !== 'II' && endian !== 'MM') return EMPTY
    const little = endian === 'II'

    const read: Reader = {
      u16: (at) => (little ? buf.readUInt16LE(at) : buf.readUInt16BE(at)),
      u32: (at) => (little ? buf.readUInt32LE(at) : buf.readUInt32BE(at)),
    }

    /** Walk one IFD, handing each entry to the caller. */
    function walk(ifdOffset: number, onEntry: (tag: number, valueAt: number, count: number) => void) {
      const at = tiff! + ifdOffset
      if (at + 2 > buf.length) return
      const count = read.u16(at)

      for (let i = 0; i < count; i++) {
        const entry = at + 2 + i * 12
        if (entry + 12 > buf.length) return
        const tag = read.u16(entry)
        const components = read.u32(entry + 4)
        // Values of four bytes or fewer sit inline; longer ones are a pointer.
        const size = read.u16(entry + 2)
        const bytes = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8][size] ?? 1
        const total = bytes * components
        const valueAt = total <= 4 ? entry + 8 : tiff! + read.u32(entry + 8)
        onEntry(tag, valueAt, components)
      }
    }

    let capturedAt: Date | null = null
    let latitude: number | null = null
    let longitude: number | null = null
    let exifIfd: number | null = null
    let gpsIfd: number | null = null

    walk(read.u32(tiff + 4), (tag, valueAt) => {
      if (tag === TAG_EXIF_IFD_POINTER) exifIfd = read.u32(valueAt)
      if (tag === TAG_GPS_IFD_POINTER) gpsIfd = read.u32(valueAt)
    })

    if (exifIfd != null) {
      walk(exifIfd, (tag, valueAt, count) => {
        if (tag !== TAG_DATETIME_ORIGINAL) return
        const raw = buf.toString('ascii', valueAt, valueAt + Math.min(count, 24))
        capturedAt = parseExifDate(raw)
      })
    }

    if (gpsIfd != null) {
      let latRef = 'N'
      let lonRef = 'E'
      let rawLat: number | null = null
      let rawLon: number | null = null

      walk(gpsIfd, (tag, valueAt) => {
        if (tag === TAG_GPS_LAT_REF) latRef = buf.toString('ascii', valueAt, valueAt + 1)
        if (tag === TAG_GPS_LON_REF) lonRef = buf.toString('ascii', valueAt, valueAt + 1)
        if (tag === TAG_GPS_LAT) rawLat = dmsToDecimal(read, valueAt)
        if (tag === TAG_GPS_LON) rawLon = dmsToDecimal(read, valueAt)
      })

      if (rawLat != null) latitude = latRef === 'S' ? -rawLat : rawLat
      if (rawLon != null) longitude = lonRef === 'W' ? -rawLon : rawLon
    }

    return { capturedAt, latitude, longitude }
  } catch {
    // Malformed metadata must never cost a worker their submission.
    return EMPTY
  }
}

/** Metres between two coordinates. Used to place a photograph at the site it claims. */
export function distanceMetres(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const R = 6_371_000
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(bLat - aLat)
  const dLon = toRad(bLon - aLon)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}
