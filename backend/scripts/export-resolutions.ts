/**
 * Export how long resolved complaints actually took.
 *
 *   npm run export:resolutions
 *
 * One row per complaint that reached RESOLVED, with the three things the SLA
 * estimator buckets by — category, holding unit, priority — and the seeded
 * deadline it was judged against, so the training run can report what the fixed
 * table was costing.
 *
 * Deliberately measures from `createdAt` to `resolvedAt`: filing to fixed, which
 * is the interval the citizen experiences. Measuring from routing would flatter
 * the numbers by excluding the time a complaint sat unrouted, and that time is
 * precisely what an oversight system should be surfacing.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

function cell(value: unknown): string {
  if (value === null || value === undefined) return ''
  const text = String(value)
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

async function main() {
  const resolved = await prisma.complaint.findMany({
    where: { resolvedAt: { not: null }, categoryId: { not: null } },
    select: {
      referenceNo: true,
      categoryId: true,
      orgUnitId: true,
      priority: true,
      createdAt: true,
      resolvedAt: true,
      escalationLevel: true,
      category: { select: { name: true, defaultSlaHours: true } },
    },
    orderBy: { id: 'asc' },
  })

  const header = [
    'reference_no',
    'category_id',
    'category_name',
    'org_unit_id',
    'priority',
    'hours',
    'default_sla_hours',
    'escalation_level',
  ]

  const rows = resolved.map((c) =>
    [
      c.referenceNo,
      c.categoryId,
      c.category?.name ?? null,
      c.orgUnitId,
      c.priority,
      ((c.resolvedAt!.getTime() - c.createdAt.getTime()) / 3_600_000).toFixed(2),
      c.category?.defaultSlaHours ?? null,
      c.escalationLevel,
    ]
      .map(cell)
      .join(','),
  )

  const out = path.resolve(process.cwd(), '../research/data/resolutions.csv')
  await mkdir(path.dirname(out), { recursive: true })
  await writeFile(out, [header.join(','), ...rows].join('\r\n') + '\r\n', 'utf8')

  console.log(`wrote ${rows.length} resolutions to research/data/resolutions.csv`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
