/**
 * Loading a model that was trained somewhere else.
 *
 * Four services execute models trained in Python and exported as JSON, and they
 * had four near-identical copies of this logic. Copies drift: the fix for a
 * caching bug landed in one of them, the contract check would have landed in
 * none. One loader means one place to get it right.
 *
 * Three things it does that a bare `readFileSync` does not.
 *
 * **It refuses a spec the code cannot execute.** Every spec carries a
 * `contract` naming the algorithm it was written for. Change the tokeniser in
 * Python, or the smoothing, or the shape of the exported table, and you bump
 * the contract on both sides — an old spec then refuses to load rather than
 * being executed by code that no longer reproduces it. Without this the failure
 * is silent: predictions shift slightly, nothing errors, and the model that
 * ships stops being the model that was measured. The parity fixtures would
 * catch it, but only if someone re-ran them.
 *
 * **It does not cache a failure in development.** Specs are generated, so the
 * usual dev sequence is to start the API, train a model, and wonder why nothing
 * changed. Caching the miss makes that permanent until restart. In production a
 * missing spec is a deployment fact and re-reading the disk on every call would
 * be waste, so the miss is cached there.
 *
 * **It says what happened, once.** Loud enough to notice at boot, quiet enough
 * not to repeat per request.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createLogger } from '../lib/logger.js'

const log = createLogger('model')

/** Every exported spec carries one of these. Bump when the maths changes. */
export interface SpecEnvelope {
  contract: string
  modelVersion: string
}

interface Cached<T> {
  spec: T | null
  /** Set once a miss has been reported, so the warning is not repeated. */
  reported: boolean
}

const cache = new Map<string, Cached<unknown>>()

/**
 * Read a spec from `backend/data`, or null if it is absent or incompatible.
 *
 * `contract` is what this code can execute. A spec declaring anything else is
 * treated as absent — the caller falls back to whatever it does without a
 * model, which for every current caller is the behaviour that shipped before
 * the model existed.
 */
export function loadSpec<T extends SpecEnvelope>(file: string, contract: string): T | null {
  /*
   * Keyed by file *and* contract, not by file alone.
   *
   * Keyed by filename only, a second caller asking for a different contract got
   * the first caller's cached spec and the check never ran — which defeats the
   * only thing this function exists to guarantee. Caught by its own test, which
   * is the argument for writing the negative case rather than only the happy one.
   */
  const key = `${file}|${contract}`
  const cached = cache.get(key) as Cached<T> | undefined

  if (cached?.spec) return cached.spec
  // A miss stays a miss in production; in development the file may appear.
  if (cached && process.env.NODE_ENV === 'production') return null

  try {
    const full = path.resolve(process.cwd(), 'data', file)
    const spec = JSON.parse(readFileSync(full, 'utf8')) as T

    if (spec.contract !== contract) {
      if (!cached?.reported) {
        log.warn(
          `${file} declares contract "${spec.contract}" but this build executes "${contract}". ` +
            'Ignoring it — retrain and re-export rather than running a model this code cannot reproduce.',
        )
      }
      cache.set(key, { spec: null, reported: true })
      return null
    }

    log.info(`loaded ${file} (${spec.modelVersion})`)
    cache.set(key, { spec, reported: true })
    return spec
  } catch {
    if (!cached?.reported) log.warn(`no ${file} found; running without it`)
    cache.set(key, { spec: null, reported: true })
    return null
  }
}

/**
 * What is loaded, for the boot banner.
 *
 * A system that silently reverts to its pre-model behaviour is the failure this
 * exists to prevent: deadlines back to the seeded guesses, the gate inert, and
 * three warnings nobody reads. Printed once at startup so it is visible rather
 * than discoverable.
 */
export function specStatus(specs: { name: string; file: string; contract: string }[]): string[] {
  return specs.map(({ name, file, contract }) => {
    const spec = loadSpec<SpecEnvelope>(file, contract)
    return spec ? `${name}: ${spec.modelVersion}` : `${name}: NOT LOADED — running without it`
  })
}
