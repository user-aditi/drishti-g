/**
 * The layering rule, on its own and without a database.
 *
 *   npm run check:layering
 *
 * The measurement scripts run this check too, but they need the 355,430-row
 * corpus, which CI does not have. The rule itself is a fact about the source, so
 * it runs here in a second and fails the build the moment a lower layer names a
 * higher layer's concept (N5). See `layering.ts` for the lists and the reasons.
 */
import { checkLayer } from './layering.js'

let failed = 0
for (const layer of [1, 2, 3, 4] as const) {
  const result = checkLayer(layer)
  console.log(`  ${result.ok ? 'PASS' : 'FAIL'}  layer ${layer}  ${result.detail}`)
  if (!result.ok) failed++
}
console.log(failed === 0 ? '\nThe baseline and every layer below the top are uncontaminated.' : `\n${failed} layer(s) leak.`)
process.exitCode = failed === 0 ? 0 : 1
