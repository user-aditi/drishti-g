/**
 * Writes the live GRIE model to research/data/model-spec.json.
 *
 * Run this whenever the weights or curves change, so the experiment harness is
 * always scoring with the model that actually runs in production. The paper's
 * central comparison is void if the two drift apart.
 *
 *   npm run export:model
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { modelSpec } from '../src/services/grie.js'

const target = path.resolve(process.cwd(), '../research/data/model-spec.json')
mkdirSync(path.dirname(target), { recursive: true })

const spec = modelSpec()
writeFileSync(target, `${JSON.stringify(spec, null, 2)}\n`, 'utf8')

const areaWeights = spec.factorSets.SECTOR?.reduce((sum, f) => sum + f.weight, 0) ?? 0
console.log(`Wrote ${target}`)
console.log(`  model ${spec.modelVersion}, threshold ${spec.reviewThreshold}`)
console.log(`  ${Object.keys(spec.factorSets).length} factor sets; SECTOR weights sum to ${areaWeights.toFixed(3)}`)
