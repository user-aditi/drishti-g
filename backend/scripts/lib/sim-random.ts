/**
 * Seeded randomness for the traffic simulator.
 *
 * Everything the simulator decides — which category a complaint is, how long an
 * officer took, whether a citizen ever answered — is drawn from here, so a run
 * with the same `--seed` produces the same event log. That matters more than it
 * looks: the log the simulator writes becomes training data for the classifier
 * and the predictor, and a dataset nobody can reproduce is a dataset nobody can
 * check.
 *
 * `Math.random` is deliberately unused in the simulator. It is unseeded, so one
 * stray call anywhere in the run makes the whole log irreproducible without
 * failing or warning.
 */

/**
 * mulberry32 — small, fast, and good enough for generating plausible workloads.
 *
 * Not cryptographic, and does not need to be: nothing here protects anything.
 * Chosen over a larger generator because reproducibility depends on the
 * algorithm never changing, and this one fits in a paragraph.
 */
export class Rng {
  private state: number

  constructor(seed: number) {
    // A zero state is a fixed point for this generator, so shift it off zero.
    this.state = (seed >>> 0) || 0x9e3779b9
  }

  /** Uniform in [0, 1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /** Uniform in [min, max). */
  float(min: number, max: number): number {
    return min + this.next() * (max - min)
  }

  /** Uniform integer in [min, max]. */
  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1))
  }

  /** True with probability `p`. */
  chance(p: number): boolean {
    return this.next() < p
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('pick() needs at least one item')
    return items[this.int(0, items.length - 1)]!
  }

  /** Pick by relative weight. Weights need not sum to anything in particular. */
  weighted<T>(items: readonly { value: T; weight: number }[]): T {
    const total = items.reduce((sum, item) => sum + item.weight, 0)
    let roll = this.next() * total
    for (const item of items) {
      roll -= item.weight
      if (roll <= 0) return item.value
    }
    return items[items.length - 1]!.value
  }

  /** Fisher-Yates, in place, using this generator. */
  shuffle<T>(items: T[]): T[] {
    for (let i = items.length - 1; i > 0; i--) {
      const j = this.int(0, i)
      ;[items[i], items[j]] = [items[j]!, items[i]!]
    }
    return items
  }

  /**
   * Exponential with the given mean.
   *
   * The default shape for "how long until someone gets round to it". Memoryless,
   * which is roughly right for a queue nobody is managing closely, and it
   * produces the long tail that a normal distribution would not — the occasional
   * complaint that sits for weeks is what makes an SLA breach rate realistic.
   */
  exponential(mean: number): number {
    return -Math.log(1 - this.next()) * mean
  }

  /**
   * Log-normal, parameterised by the median and how wide the spread is.
   *
   * Used where a delay has a floor — an officer cannot inspect work in negative
   * time, and most inspections cluster around a typical duration with a tail of
   * slow ones. `sigma` around 0.5 gives a mild tail; 1.0 gives a heavy one.
   */
  logNormal(median: number, sigma: number): number {
    // Box-Muller, taking one of the two normals.
    const u1 = Math.max(this.next(), Number.EPSILON)
    const u2 = this.next()
    const normal = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
    return median * Math.exp(sigma * normal)
  }

  /**
   * Poisson, by Knuth's method.
   *
   * Arrivals per day. Knuth's algorithm is O(lambda), which is fine at the
   * couple-of-dozen-a-day this runs at and would not be at thousands.
   */
  poisson(lambda: number): number {
    const limit = Math.exp(-lambda)
    let count = 0
    let product = this.next()
    while (product > limit) {
      count++
      product *= this.next()
    }
    return count
  }
}
