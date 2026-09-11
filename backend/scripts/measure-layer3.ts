/**
 * Layer 3's measurement — and first, whether the model running is the model
 * that was measured.
 *
 *   npm run layer3:measure
 *
 * GRIE's evaluation happened in Python, on signals Python computed. The backend
 * computes the same signals in SQL from its own copy of the requests and applies
 * the exported weights and calibration. If those disagree by a hair, every AUC
 * in the paper describes a model nobody runs. So the first check compares every
 * unit-month of the study's panel — each of the five signals, the next month's
 * rate, the score and the probability — against what this backend produces.
 *
 * Then the questions the plan asked. Do high-scored boards fail next month? The
 * stored rows answer it for every month on record, but those are the months the
 * model was fitted on, so the figure is in-sample and is printed as such; the
 * honest out-of-sample numbers are the study's cross-validated ones, read from
 * the spec. And GCCE's routing accuracy, read from its export: measured, not run.
 *
 * Then that Layers 0 to 2 reference no Layer 3 concept, and the chain.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { verifyChain } from '../src/services/audit.js'
import { grieSpec, scoreUnit, SIGNAL_KEYS } from '../src/services/grie.js'
import { loadSpec, type SpecEnvelope } from '../src/services/modelSpec.js'
import { signalsOf } from '../src/services/riskScores.js'
import { unitMonths } from '../src/services/riskSignals.js'

const prisma = new PrismaClient()
const PANEL = fileURLToPath(new URL('../../research/results/nyc-grie-panel.csv', import.meta.url))
const TOLERANCE = 1e-9

const LOWER_LAYER_FILES = [
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
  'src/utils/serialize.ts',
  'src/config/systemClock.ts',
  'src/routes/officer.ts',
  'src/routes/supervisor.ts',
  'src/routes/workOrders.ts',
  'src/services/assignment.ts',
  'src/services/workOrder.ts',
  'src/services/qr.ts',
  'src/utils/serializeLayer1.ts',
  'src/routes/escalations.ts',
  'src/services/escalation.ts',
  'src/utils/serializeLayer2.ts',
]
const LAYER3_TERMS = /\b(RiskScore|riskScore|risk_scores|grie|GRIE|Grie|gcce|GCCE|ADMIN)\b/

interface Result {
  name: string
  ok: boolean
  detail: string
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

/** Mann-Whitney AUC with average ranks for ties. */
function auc(scores: number[], labels: boolean[]): number {
  const order = scores.map((s, i) => [s, labels[i]] as const).sort((a, b) => a[0] - b[0])
  let rankSum = 0
  let positives = 0
  for (let i = 0; i < order.length; ) {
    let j = i
    while (j < order.length && order[j]![0] === order[i]![0]) j++
    const average = (i + 1 + j) / 2
    for (let k = i; k < j; k++) if (order[k]![1]) (rankSum += average), positives++
    i = j
  }
  const negatives = order.length - positives
  return (rankSum - (positives * (positives + 1)) / 2) / (positives * negatives)
}

async function parity(): Promise<Result> {
  const spec = grieSpec()
  if (!spec) return { name: 'parity', ok: false, detail: 'no GRIE model loaded' }

  const [header, ...lines] = readFileSync(PANEL, 'utf8').trim().split(/\r?\n/)
  const columns = header!.split(',')
  const panel = lines.map((line) => Object.fromEntries(line.split(',').map((v, i) => [columns[i], v])))

  const ours = new Map(
    (await unitMonths(spec.markers, spec.minRequests)).map((m) => [
      `${m.agencyCode}|${m.boardCode}|${m.month.toISOString().slice(0, 7)}`,
      m,
    ]),
  )

  const fields = ['requests', ...SIGNAL_KEYS, 'nextBreachRate', 'score', 'probability'] as const
  const worst: Record<string, number> = Object.fromEntries(fields.map((f) => [f, 0]))
  const misses: Record<string, number> = Object.fromEntries(fields.map((f) => [f, 0]))
  const examples: string[] = []
  let missing = 0

  for (const row of panel) {
    const key = `${row.agency}|BK-${String(row.board).padStart(2, '0')}|${row.month}`
    const m = ours.get(key)
    if (!m) {
      missing++
      if (examples.length < 5) examples.push(`${key} not produced`)
      continue
    }
    const scored = scoreUnit(spec, signalsOf(m), m.agencyCode)
    const mine: Record<string, number> = {
      requests: m.requests,
      ...signalsOf(m),
      nextBreachRate: m.nextBreachRate ?? Number.NaN,
      score: scored.score,
      probability: scored.probability,
    }
    for (const field of fields) {
      const diff = Math.abs(mine[field]! - Number(row[field]))
      if (!(diff <= TOLERANCE)) {
        misses[field]!++
        worst[field] = Math.max(worst[field]!, Number.isNaN(diff) ? Infinity : diff)
        if (misses[field]! <= 2) examples.push(`${key} ${field}: ours ${mine[field]} vs study ${row[field]}`)
      }
    }
  }

  const bad = fields.filter((f) => misses[f]! > 0)
  const ok = missing === 0 && bad.length === 0
  return {
    name: 'parity',
    ok,
    detail: ok
      ? `${panel.length.toLocaleString('en-US')} of ${panel.length.toLocaleString('en-US')} study unit-months reproduced: ` +
        `requests, all five signals, next month's rate, score and probability within ${TOLERANCE} of the study`
      : `${missing} unit-months missing; mismatches ${bad.map((f) => `${f} ${misses[f]} (max ${worst[f]!.toExponential(2)})`).join(', ')}; e.g. ${examples.join('; ')}`,
  }
}

async function outcomes(): Promise<Result[]> {
  const spec = grieSpec()
  if (!spec) return [{ name: 'stored', ok: false, detail: 'no GRIE model loaded' }]
  const rows = await prisma.riskScore.findMany({
    where: { modelVersion: spec.modelVersion },
    select: { score: true, probability: true, needsReview: true, outcome: true, agency: { select: { code: true } } },
  })
  if (rows.length === 0) {
    return [{ name: 'stored', ok: false, detail: `no scores stored for ${spec.modelVersion}; run npm run risk:recompute` }]
  }
  const known = rows.filter((r) => r.outcome !== null)
  const pooled = auc(known.map((r) => r.score), known.map((r) => r.outcome!))
  const agencies = [...new Set(known.map((r) => r.agency.code))]
  const within =
    agencies
      .map((a) => known.filter((r) => r.agency.code === a))
      .map((g) => auc(g.map((r) => r.score), g.map((r) => r.outcome!)))
      .reduce((s, v) => s + v, 0) / agencies.length
  const flagged = known.filter((r) => r.needsReview)
  const meanP = known.reduce((s, r) => s + r.probability, 0) / known.length
  const observed = known.filter((r) => r.outcome).length / known.length
  const cv = spec.evaluation.candidates[spec.chosen]!

  return [
    {
      name: 'stored',
      ok: true,
      detail: `${rows.length.toLocaleString('en-US')} unit-months scored by ${spec.modelVersion}; ${rows.filter((r) => r.needsReview).length} flagged; ${known.length.toLocaleString('en-US')} with next month on record`,
    },
    {
      name: 'next month',
      ok: true,
      detail:
        `in-sample (fitted on these months) AUC ${pooled.toFixed(4)}, within agency ${within.toFixed(4)}; ` +
        `out-of-sample, from the study's grouped CV: ${cv.cvAuc.toFixed(4)} and ${cv.withinAgencyAuc.toFixed(4)}. ` +
        `Of ${flagged.length} flagged, ${flagged.filter((r) => r.outcome).length} (${pct(flagged.filter((r) => r.outcome).length / Math.max(flagged.length, 1))}) landed in the worst fifth; ` +
        `mean probability ${pct(meanP)} against ${pct(observed)} observed`,
    },
  ]
}

function routing(): Result {
  const spec = loadSpec<SpecEnvelope & { chosen: string; evaluation: any }>('gcce-spec.json', 'gcce-table/1')
  if (!spec) return { name: 'routing', ok: false, detail: 'no routing measurement exported' }
  const e = spec.evaluation
  const perType = Object.entries(e.perType as Record<string, { modal: number; chosen: number }>)
    .map(([t, v]) => `${t} ${pct(v.modal)} -> ${pct(v.chosen)}`)
    .join(', ')
  return {
    name: 'routing',
    ok: e.gatePassed,
    detail:
      `${e.testYear} accuracy ${pct(e.accuracy[spec.chosen])} vs ${pct(e.accuracy.modal)} always choosing the usual agency, ` +
      `gain ${(e.gainOverModal.gain * 100).toFixed(2)} points [${(e.gainOverModal.ciLow * 100).toFixed(2)}, ${(e.gainOverModal.ciHigh * 100).toFixed(2)}]. ` +
      `Per type: ${perType}. The gain is NYC's own descriptor rule; measured, not run (F-23)`,
  }
}

function layering(): Result {
  const hits: string[] = []
  for (const file of LOWER_LAYER_FILES) {
    const source = readFileSync(fileURLToPath(new URL(`../${file}`, import.meta.url)), 'utf8')
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    code.split('\n').forEach((line, i) => {
      const match = LAYER3_TERMS.exec(line)
      if (match) hits.push(`${file}:${i + 1} "${match[0]}"`)
    })
  }
  return {
    name: 'layering',
    ok: hits.length === 0,
    detail:
      hits.length === 0
        ? `${LOWER_LAYER_FILES.length} Layer 0-2 source files reference no Layer 3 concept`
        : `a lower layer reaches into Layer 3: ${hits.join('; ')}`,
  }
}

async function main() {
  console.log('Measuring Layer 3 — GRIE, and the GCCE routing report\n')
  const spec = grieSpec()
  if (spec) {
    const c = spec.evaluation.candidates
    console.log(`The model: ${spec.modelVersion}, chosen by the rule declared in nyc_grie.py`)
    console.log(`  predicts: ${spec.label.description} (base rate ${pct(spec.label.baseRate)})`)
    console.log(`  weights:  ${spec.factors.map((f) => `${f.label} ${f.weight.toFixed(2)}`).join(', ')}`)
    console.log('  cross-validated AUC (within agency):')
    for (const [name, v] of Object.entries(c)) {
      console.log(`    ${name.padEnd(14)} ${v.cvAuc.toFixed(4)} (${v.withinAgencyAuc.toFixed(4)})${name === spec.chosen ? '  <- shipped' : ''}`)
    }
    const h = spec.evaluation.shippedVsHand
    const p = spec.evaluation.shippedVsPersistence
    console.log(`  vs hand-specified:        ${h.aucGap >= 0 ? '+' : ''}${h.aucGap.toFixed(4)} [${h.ciLow.toFixed(4)}, ${h.ciHigh.toFixed(4)}]`)
    console.log(`  vs missed deadlines alone: ${p.aucGap >= 0 ? '+' : ''}${p.aucGap.toFixed(4)} [${p.ciLow.toFixed(4)}, ${p.ciHigh.toFixed(4)}]  (F-38)\n`)
  }

  const results: Result[] = [await parity(), ...(await outcomes()), routing(), layering()]
  const chain = await verifyChain(prisma)
  results.push({
    name: 'chain',
    ok: chain.valid,
    detail: chain.valid ? `${chain.checked} entries verify` : `broken at ${chain.brokenAtId}: ${chain.reason}`,
  })
  for (const r of results) console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name.padEnd(11)} ${r.detail}`)

  const failed = results.filter((r) => !r.ok).length
  console.log(failed === 0 ? '\nAll checks pass.' : `\n${failed} check(s) failed.`)
  process.exitCode = failed === 0 ? 0 : 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
