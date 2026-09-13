/**
 * Which source file belongs to which layer, and what each layer may not say.
 *
 * The baseline's value is that it is uncontaminated (N5): Layer 0 must measure
 * NYC 311 without anything this project adds, and each layer above may lean on
 * the ones below but never the other way round. That rule is checked by reading
 * the source — a file in a lower layer that names a higher layer's concept has
 * reached upwards.
 *
 * The check used to live inside three measurement scripts, each with its own
 * copy of the file lists and its own copy of the scan. Those scripts need the
 * full imported corpus, so CI could not run them, and three copies of the lists
 * had already begun to differ in which files they named. This is the one copy.
 * The measurement scripts and `npm run check:layering` both read it.
 *
 * Comments are stripped before scanning, because several lower files explain in
 * prose why a higher concept is absent from them.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export type Layer = 0 | 1 | 2 | 3 | 4

/**
 * Every file a layer owns. The composition root (`app.ts`, `index.ts`) and
 * shared infrastructure (`lib/`, `config/env.ts`, the generic middleware) belong
 * to no layer: they are where the layers are wired together.
 */
export const LAYER_FILES: Record<Layer, string[]> = {
  0: [
    'src/routes/auth.ts',
    'src/routes/system.ts',
    'src/routes/requests.ts',
    'src/routes/taxonomy.ts',
    'src/routes/boards.ts',
    'src/routes/map.ts',
    'src/routes/audit.ts',
    'src/services/audit.ts',
    'src/services/routing.ts',
    'src/services/requestHooks.ts',
    'src/services/status.ts',
    'src/utils/serialize.ts',
    'src/config/systemClock.ts',
    'src/middleware/rateLimit.ts',
    'src/middleware/auth.ts',
    'src/lib/jobRuns.ts',
    'src/services/modelSpec.ts',
    'src/services/notifications.ts',
    'src/routes/notifications.ts',
    'src/middleware/photos.ts',
    'src/utils/csv.ts',
  ],
  1: [
    'src/routes/officer.ts',
    'src/routes/supervisor.ts',
    'src/routes/workOrders.ts',
    'src/services/assignment.ts',
    'src/services/workOrder.ts',
    'src/services/qr.ts',
    'src/utils/serializeLayer1.ts',
  ],
  2: ['src/routes/escalations.ts', 'src/services/escalation.ts', 'src/utils/serializeLayer2.ts'],
  3: [
    'src/routes/risk.ts',
    'src/routes/routing.ts',
    'src/routes/admin.ts',
    'src/routes/adminPeople.ts',
    'src/routes/adminSystem.ts',
    'src/services/grie.ts',
    'src/services/riskScores.ts',
    'src/services/riskSignals.ts',
  ],
  4: [
    'src/routes/proof.ts',
    'src/services/proof.ts',
    'src/services/proofImage.ts',
    'src/services/exif.ts',
    'src/middleware/upload.ts',
  ],
}

/** The words that mean a layer's concept has leaked below it. */
export const LAYER_TERMS: Record<Exclude<Layer, 0>, RegExp> = {
  1: /\b(officer|supervisor|posting|assignment|assignedOfficer|workOrder|work_order|OFFICER|SUPERVISOR)\w*/,
  2: /\b(escalat\w*|Escalat\w*|COMMISSIONER|commissioner)/,
  3: /\b(RiskScore|riskScore|risk_scores|grie|GRIE|Grie|gcce|GCCE|ADMIN)\b/,
  4: /\b(proof|Proof|workPhoto|WorkPhoto|work_photos|workProof|WorkProof|work_proofs|dHash|uploadProof|readExif)\w*/,
}

const NAMES: Record<Layer, string> = {
  0: 'the baseline',
  1: 'officer identity',
  2: 'escalation',
  3: 'risk and routing',
  4: 'photo verification',
}

export interface LayeringResult {
  layer: Exclude<Layer, 0>
  checked: number
  hits: string[]
  ok: boolean
  detail: string
}

/** Strip block and line comments, leaving `//` inside a URL alone. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

/** Do the layers below `layer` avoid every one of its terms? */
export function checkLayer(layer: Exclude<Layer, 0>): LayeringResult {
  const below = ([0, 1, 2, 3] as const).filter((l) => l < layer).flatMap((l) => LAYER_FILES[l])
  const terms = LAYER_TERMS[layer]
  const hits: string[] = []

  for (const file of below) {
    const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8')
    code(source)
      .split('\n')
      .forEach((line, i) => {
        const match = terms.exec(line)
        if (match) hits.push(`${file}:${i + 1} "${match[0]}"`)
      })
  }

  const range = layer === 1 ? 'Layer 0' : `Layers 0–${layer - 1}`
  return {
    layer,
    checked: below.length,
    hits,
    ok: hits.length === 0,
    detail:
      hits.length === 0
        ? `${below.length} source files in ${range} reference no Layer ${layer} (${NAMES[layer]}) concept, comments excluded`
        : `a lower layer reaches into Layer ${layer}: ${hits.join('; ')}`,
  }
}
