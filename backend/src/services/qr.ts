/**
 * QR codes for work orders.
 *
 * Carried over from the NOIDA system. A thin wrapper over the `qrcode` library
 * rather than a hand-rolled encoder: QR is a published specification with
 * Reed-Solomon error correction inside it, and bespoke error-correction maths is
 * exactly the kind of thing that works on a developer's screen and fails on a
 * creased slip.
 *
 * Error correction is set high on purpose. These are printed, folded into a
 * pocket, rained on and scanned by an old phone; the extra redundancy is what
 * lets a damaged code still open the job.
 */
import QRCode from 'qrcode'

/** A data URI, so the page can show it without a second request or a CORP exemption. */
export function qrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    errorCorrectionLevel: 'H',
    margin: 2,
    width: 320,
  })
}
