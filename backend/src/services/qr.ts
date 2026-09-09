/**
 * QR codes for work orders.
 *
 * A thin wrapper over the `qrcode` library rather than a hand-rolled encoder:
 * QR is a published specification with Reed-Solomon error correction inside it,
 * and bespoke error-correction maths is exactly the kind of thing that works on
 * a developer's screen and fails on a scratched slip in the sun.
 *
 * Error correction is set high on purpose. These are printed on paper that goes
 * into a work bag, gets rained on, and is scanned by an eight-year-old phone.
 */
import QRCode from 'qrcode'

export function qrSvg(text: string): Promise<string> {
  return QRCode.toString(text, {
    type: 'svg',
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 320,
  })
}

/** A data URI, for embedding in a page an officer is about to print. */
export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 320,
  })
}
