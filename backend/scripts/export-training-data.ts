/**
 * Export complaint text with every label the system has for it.
 *
 *   npm run export:training
 *
 * Three label columns, deliberately kept apart rather than merged into one
 * "the answer" column, because they are not the same kind of thing and the
 * difference decides what any model trained on them is worth.
 *
 *   `gcce_category`      what the keyword matcher decided. There are thousands
 *                        of these and they are **circular**: a classifier
 *                        trained on them learns to imitate the matcher it is
 *                        meant to replace, and "beats the keyword baseline"
 *                        becomes a statement about how well it copied.
 *
 *   `confirmed_category` what a citizen said when shown the classification.
 *                        Genuine supervision, and the only label here that
 *                        would exist on a real deployment. There are a few
 *                        dozen — far too few to train ten classes on, and that
 *                        scarcity is itself the finding: the product has only
 *                        just started being able to record agreement at all.
 *
 *   `true_category`      which template generated the complaint, from
 *                        research/data/sim-labels.csv. Real ground truth *for
 *                        this dataset*, uncontaminated by the matcher — and it
 *                        exists only because the dataset was generated.
 *
 * So the usable training label today is the third, and anything measured
 * against it demonstrates that the pipeline works rather than saying anything
 * about municipal text. `classifier.py` states that at the point of use, and it
 * reports accuracy against the first two as well, because the gap between "can
 * reproduce the matcher" and "can recover the truth the matcher missed" is the
 * only interesting number in the exercise.
 */
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { DecisionKind, DecisionOutcome, PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

/** RFC 4180 escaping — complaint text contains commas, quotes and newlines. */
function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

/** Read the simulator's ground truth, if a run has produced any. */
async function readGroundTruth(file: string): Promise<Map<string, string>> {
  const labels = new Map<string, string>()
  try {
    const stream = createInterface({ input: createReadStream(file, 'utf8') })
    let first = true
    for await (const line of stream) {
      if (first) {
        first = false
        continue
      }
      if (!line.trim()) continue
      const comma = line.indexOf(',')
      if (comma < 0) continue
      const reference = line.slice(0, comma)
      const category = line.slice(comma + 1).replace(/^"|"$/g, '')
      labels.set(reference, category)
    }
  } catch {
    // No run has written labels yet. The export still works, with the column
    // empty and the reason printed, rather than failing.
  }
  return labels
}

async function main() {
  const root = path.resolve(process.cwd(), '..')
  const truth = await readGroundTruth(path.join(root, 'research/data/sim-labels.csv'))

  const complaints = await prisma.complaint.findMany({
    select: {
      referenceNo: true,
      title: true,
      description: true,
      createdAt: true,
      category: { select: { id: true, name: true } },
      decisions: {
        where: { kind: DecisionKind.CATEGORY },
        orderBy: { id: 'desc' },
        take: 1,
        select: { outcome: true, chosen: true, overriddenTo: true, confidence: true },
      },
    },
    orderBy: { id: 'asc' },
  })

  const categories = await prisma.complaintCategory.findMany({ select: { id: true, name: true } })
  const nameOf = new Map(categories.map((c) => [String(c.id), c.name]))

  const header = [
    'reference_no',
    'title',
    'description',
    'gcce_category',
    'confirmed_category',
    'true_category',
    'gcce_confidence',
    'created_at',
  ]

  const rows = complaints.map((c) => {
    const decision = c.decisions[0]

    // A citizen's answer, where they gave one. CONFIRMED means they endorsed
    // what the engine chose; OVERRIDDEN means they replaced it, and
    // `overriddenTo` of 'unclassified' means "wrong, and I do not know what it
    // should be" — which is a refusal, not a label.
    let confirmed: string | null = null
    if (decision?.outcome === DecisionOutcome.CONFIRMED) {
      confirmed = nameOf.get(decision.chosen) ?? null
    } else if (decision?.outcome === DecisionOutcome.OVERRIDDEN) {
      confirmed = decision.overriddenTo ? (nameOf.get(decision.overriddenTo) ?? null) : null
    }

    return [
      c.referenceNo,
      c.title,
      c.description,
      c.category?.name ?? null,
      confirmed,
      truth.get(c.referenceNo) ?? null,
      decision?.confidence ?? null,
      c.createdAt.toISOString(),
    ]
      .map(cell)
      .join(',')
  })

  const out = path.join(root, 'research/data/complaints.csv')
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, [header.join(','), ...rows].join('\r\n') + '\r\n', 'utf8')

  const withTruth = complaints.filter((c) => truth.has(c.referenceNo)).length
  const withConfirmed = rows.filter((r) => r.split(',').length > 4).length

  console.log(`wrote ${rows.length} complaints to research/data/complaints.csv`)
  console.log(`  with ground truth      ${withTruth}`)
  console.log(`  with a citizen's answer ${await countAnswered()}`)
  if (withTruth === 0) {
    console.log(
      '\n  No ground truth found. Run `npm run sim:run -- --reset` first — without it\n' +
        '  the only labels are the keyword matcher\'s own, and training on those\n' +
        '  teaches a classifier to reproduce the matcher rather than replace it.',
    )
  }
  void withConfirmed

  await prisma.$disconnect()
}

async function countAnswered(): Promise<number> {
  return prisma.decision.count({
    where: {
      kind: DecisionKind.CATEGORY,
      outcome: { in: [DecisionOutcome.CONFIRMED, DecisionOutcome.OVERRIDDEN] },
    },
  })
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
