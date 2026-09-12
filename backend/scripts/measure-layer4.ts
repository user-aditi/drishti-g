/**
 * Layer 4's measurement: what is the recycled-photograph check worth?
 *
 *   npm run layer4:measure
 *
 * One number decides that check, and it is a genuine trade. The difference hash
 * calls two photographs the same when at most `t` of its 64 bits differ. Raise
 * `t` and a crew re-sending last week's picture is caught even after their phone
 * re-encoded it; raise it too far and two different potholes on the same grey
 * road are called the same photograph, and an honest crew is refused.
 *
 * Neither side of that can be guessed, so both are measured on real civic
 * photographs — the QR4Change sample (CC BY 4.0, doi:10.17632/zndzygc3p3.2),
 * 250 each of potholes, plain road, garbage and clean streets:
 *
 *   false matches   every pair of *different* photographs, at each threshold.
 *                   These are the honest crews the check would refuse. Pairs that
 *                   are the same file stored twice are counted separately: the
 *                   check calling those the same photograph is correct, and
 *                   counting them as failures would drive the threshold to zero
 *                   on the strength of the dataset's own duplicates.
 *   copies caught   every photograph put through what actually happens to a
 *                   picture between one job and the next — re-encoded by a
 *                   gallery app, resized for sending, cropped, brightened — and
 *                   re-hashed. These are the recycled submissions it would catch.
 *
 * The threshold that ships is chosen by a rule declared here before the run: the
 * largest `t` whose false-match rate stays at or below one in 100,000 pairs.
 * Refusing an honest crew is the worse error — they are standing at the site with
 * the work done — so the rule protects them first and takes whatever detection
 * that leaves.
 *
 * What this cannot tell you: whether the pothole is filled. No threshold makes a
 * photograph proof of repair, and nothing in Layer 4 claims it does.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import sharp from 'sharp'
import { dHashOf, hamming, sha256Of } from '../src/services/proofImage.js'
import { PROOF_CONTRACT } from '../src/services/proof.js'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SAMPLE = path.join(ROOT, 'research', 'data', 'qr4change')
const MANIFEST = path.join(SAMPLE, 'manifest.json')
const SPEC_OUT = path.join(ROOT, 'backend', 'data', 'proof-spec.json')
const RESULTS_OUT = path.join(ROOT, 'research', 'results', 'proof-threshold.csv')

/** The rule, fixed before the run: protect the honest crew first. */
const MAX_FALSE_MATCH_RATE = 1e-5
const THRESHOLDS = Array.from({ length: 17 }, (_, t) => t)

interface Manifest {
  dataset: string
  doi: string
  licence: string
  citation: string
  photographs: number
  files: { file: string; bytes: number; sha256: string }[]
}

/** What a picture goes through between one job and the next. */
const TRANSFORMS: Record<string, (bytes: Buffer) => Promise<Buffer>> = {
  // Shared through a gallery app: same pixels, new file, new SHA-256.
  're-encoded (JPEG 70)': (b) => sharp(b).jpeg({ quality: 70 }).toBuffer(),
  // Sent over a chat app, which shrinks it.
  'resized to half': async (b) => {
    const meta = await sharp(b).metadata()
    return sharp(b)
      .resize(Math.max(32, Math.round((meta.width ?? 64) / 2)))
      .jpeg({ quality: 85 })
      .toBuffer()
  },
  // Cropped a little, to hide a timestamp or a landmark.
  'cropped 10%': async (b) => {
    const meta = await sharp(b).metadata()
    const w = meta.width ?? 64
    const h = meta.height ?? 64
    return sharp(b)
      .extract({
        left: Math.round(w * 0.05),
        top: Math.round(h * 0.05),
        width: Math.max(16, Math.round(w * 0.9)),
        height: Math.max(16, Math.round(h * 0.9)),
      })
      .jpeg({ quality: 90 })
      .toBuffer()
  },
  // Brightened, as a filter or an auto-enhance would.
  brightened: (b) => sharp(b).modulate({ brightness: 1.15 }).jpeg({ quality: 90 }).toBuffer(),
}

const pct = (v: number) => `${(v * 100).toFixed(2)}%`

async function main() {
  let manifest: Manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as Manifest
  } catch {
    console.error(
      `No photographs found. Fetch the sample first:\n  cd research && python -m drishti_research.qr4change`,
    )
    process.exitCode = 1
    return
  }

  console.log('Measuring Layer 4 — the recycled-photograph check\n')
  console.log(manifest.citation)
  console.log(`${manifest.photographs} photographs, ${(manifest.files.reduce((s, f) => s + f.bytes, 0) / 1e9).toFixed(2)} GB\n`)

  // --- hash every photograph, and every copy of it ------------------------------
  const originals: { file: string; hash: string; sha256: string }[] = []
  const caught: Record<string, { tested: number; distances: number[] }> = Object.fromEntries(
    Object.keys(TRANSFORMS).map((name) => [name, { tested: 0, distances: [] }]),
  )
  let undecodable = 0

  for (const [i, entry] of manifest.files.entries()) {
    const bytes = readFileSync(path.join(SAMPLE, entry.file))
    const hash = await dHashOf(bytes)
    if (!hash) {
      undecodable++
      continue
    }
    originals.push({ file: entry.file, hash, sha256: sha256Of(bytes) })

    for (const [name, apply] of Object.entries(TRANSFORMS)) {
      try {
        const copy = await apply(bytes)
        const copyHash = await dHashOf(copy)
        const distance = hamming(hash, copyHash)
        if (distance !== null) {
          caught[name]!.tested++
          caught[name]!.distances.push(distance)
        }
      } catch {
        // A transform that cannot be applied to this image tells us nothing
        // about the threshold; it is left out rather than counted as a miss.
      }
    }
    if ((i + 1) % 100 === 0) console.log(`  hashed ${i + 1}/${manifest.files.length}`)
  }

  // --- every distinct pair -------------------------------------------------------
  console.log(`\n${originals.length} photographs hashed (${undecodable} could not be decoded)`)
  const falseAt = new Map<number, number>(THRESHOLDS.map((t) => [t, 0]))
  const identical: string[] = []
  let pairs = 0
  let duplicateFiles = 0

  for (let i = 0; i < originals.length; i++) {
    for (let j = i + 1; j < originals.length; j++) {
      const a = originals[i]!
      const b = originals[j]!
      // The same file stored twice. The check is right to match these, so they
      // are not false matches; they are counted and reported on their own.
      if (a.sha256 === b.sha256) {
        duplicateFiles++
        continue
      }
      pairs++
      const distance = hamming(a.hash, b.hash)!
      for (const t of THRESHOLDS) if (distance <= t) falseAt.set(t, falseAt.get(t)! + 1)
      // Distance 0 between two different files is either the same scene shot
      // twice or this check's worst case; either way it is worth naming.
      if (distance === 0 && identical.length < 10) {
        identical.push(`${a.file} ~ ${b.file}`)
      }
    }
  }

  // --- the table, then the rule --------------------------------------------------
  const names = Object.keys(TRANSFORMS)
  console.log(
    `\n${pairs.toLocaleString('en-US')} pairs of different photographs` +
      (duplicateFiles > 0
        ? `, and ${duplicateFiles} pair(s) that are the same file stored twice in the dataset — ` +
          'matched correctly, and left out of the false-match count below'
        : '') +
      '\n',
  )
  console.log(
    `  ${'t'.padEnd(4)}${'false matches'.padStart(15)}${'rate'.padStart(12)}   ` +
      names.map((n) => n.padStart(20)).join(''),
  )
  const rows: string[] = ['threshold,false_matches,false_match_rate,' + names.map((n) => n.replace(/[ ()%]/g, '_')).join(',')]
  for (const t of THRESHOLDS) {
    const falses = falseAt.get(t)!
    const rate = falses / pairs
    const caughtAt = names.map((n) => caught[n]!.distances.filter((d) => d <= t).length / Math.max(caught[n]!.tested, 1))
    console.log(
      `  ${String(t).padEnd(4)}${falses.toLocaleString('en-US').padStart(15)}${rate.toExponential(1).padStart(12)}   ` +
        caughtAt.map((v) => pct(v).padStart(20)).join(''),
    )
    rows.push([t, falses, rate, ...caughtAt].join(','))
  }
  writeFileSync(RESULTS_OUT, rows.join('\n') + '\n')

  const eligible = THRESHOLDS.filter((t) => falseAt.get(t)! / pairs <= MAX_FALSE_MATCH_RATE)
  const threshold = eligible.length > 0 ? Math.max(...eligible) : 0
  const transforms = Object.fromEntries(
    names.map((n) => [n, caught[n]!.distances.filter((d) => d <= threshold).length / Math.max(caught[n]!.tested, 1)]),
  )
  const overall =
    names.reduce((sum, n) => sum + caught[n]!.distances.filter((d) => d <= threshold).length, 0) /
    Math.max(names.reduce((sum, n) => sum + caught[n]!.tested, 0), 1)

  console.log(
    `\nthreshold ${threshold}: the largest with a false-match rate at or below ${MAX_FALSE_MATCH_RATE.toExponential(0)}`,
  )
  console.log(`  false matches ${falseAt.get(threshold)} in ${pairs.toLocaleString('en-US')} pairs (${pct(falseAt.get(threshold)! / pairs)})`)
  for (const [name, rate] of Object.entries(transforms)) console.log(`  ${name.padEnd(22)} caught ${pct(rate)}`)
  console.log(`  all copies             caught ${pct(overall)}`)
  if (identical.length > 0) {
    console.log(`\n  different files that hash identically (${identical.length} shown) — the same scene shot twice, or this check's worst case:`)
    for (const pair of identical) console.log(`    ${pair}`)
  }

  const spec = {
    contract: PROOF_CONTRACT,
    modelVersion: `dhash64-t${threshold}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`,
    trainedAt: new Date().toISOString(),
    source: 'backend/scripts/measure-layer4.ts',
    rule: `largest threshold whose false-match rate is at most ${MAX_FALSE_MATCH_RATE}`,
    threshold,
    measurement: {
      photographs: originals.length,
      pairs,
      falseMatches: falseAt.get(threshold)!,
      falseMatchRate: falseAt.get(threshold)! / pairs,
      duplicateFilePairs: duplicateFiles,
      transforms,
      caughtOverall: overall,
      identicalPairsSeen: identical.length,
    },
    dataset: { name: manifest.dataset, doi: manifest.doi, licence: manifest.licence },
    limits: [
      'Measured on Pune street photography, not on New York, and not on photographs of repairs.',
      'A rotated or mirrored copy is not caught: this hash is not rotation invariant.',
      'Nothing here tells whether the work was done. It tells whether the photograph is new.',
    ],
  }
  writeFileSync(SPEC_OUT, JSON.stringify(spec, null, 2) + '\n')
  console.log(`\nwritten backend/data/proof-spec.json and research/results/proof-threshold.csv`)
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
