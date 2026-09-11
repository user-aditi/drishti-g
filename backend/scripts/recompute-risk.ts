/**
 * Score every unit-month with the exported GRIE model and store the result.
 *
 *   npm run risk:recompute
 *
 * The same recompute the administrator's button runs, for setup and for after
 * a new model is exported. Audited as the system rather than as a person.
 */
import { prisma } from '../src/lib/prisma.js'
import { recompute } from '../src/services/riskScores.js'

recompute({ id: null, label: 'risk:recompute script' })
  .then((r) => {
    console.log(
      `${r.modelVersion}: ${r.unitMonths.toLocaleString('en-US')} unit-months scored ` +
        `(${r.firstMonth} to ${r.lastMonth}), ${r.flagged} flagged for review, in ${(r.tookMs / 1000).toFixed(1)}s`,
    )
  })
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
