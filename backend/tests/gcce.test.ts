/**
 * GCCE's pure decisions — category matching, distance, and the state machine.
 *
 * These need no database. They are the parts a reader of the paper is most
 * likely to challenge ("how does it decide the department?"), so they should be
 * the parts that are hardest to break silently.
 */
import { describe, expect, it } from 'vitest'
import { ComplaintStatus } from '@prisma/client'
import { canTransition, haversineKm, matchCategory } from '../src/services/gcce.js'

const CATEGORIES = [
  { id: 1, name: 'Street lighting', keywords: 'light, streetlight, lamp, dark, pole' },
  { id: 2, name: 'Sanitation', keywords: 'garbage, waste, kachra, bin, sweeping' },
  { id: 3, name: 'Drainage', keywords: 'drain, nala, sewer, overflow, water logging' },
]

describe('category matching', () => {
  it('picks the category whose keywords appear', () => {
    const match = matchCategory('The streetlight on my lane is broken', CATEGORIES)
    expect(match?.id).toBe(1)
  })

  it('prefers the category with more hits when several match', () => {
    const match = matchCategory('Garbage and waste piled next to the bin', CATEGORIES)
    expect(match?.id).toBe(2)
    expect(match?.hits).toBeGreaterThan(1)
  })

  it('respects word boundaries — "light" must not match inside "delighted"', () => {
    // The bug this guards against would route every happy message to street
    // lighting.
    expect(matchCategory('I am delighted with the service', CATEGORIES)).toBeNull()
  })

  it('is case insensitive', () => {
    expect(matchCategory('DRAIN is blocked', CATEGORIES)?.id).toBe(3)
  })

  it('matches transliterated Hindi keywords', () => {
    expect(matchCategory('kachra saaf nahi hua', CATEGORIES)?.id).toBe(2)
  })

  it('returns null rather than guessing when nothing matches', () => {
    // A wrong department is worse than an unrouted complaint: it looks handled.
    expect(matchCategory('The officer was very helpful today', CATEGORIES)).toBeNull()
  })

  it('ignores punctuation around a keyword', () => {
    expect(matchCategory('Overflow, again!', CATEGORIES)?.id).toBe(3)
  })
})

describe('distance', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(28.57, 77.32, 28.57, 77.32)).toBeCloseTo(0, 5)
  })

  it('is symmetric', () => {
    const a = haversineKm(28.57, 77.32, 28.61, 77.37)
    const b = haversineKm(28.61, 77.37, 28.57, 77.32)
    expect(a).toBeCloseTo(b, 9)
  })

  it('measures a known Noida distance within a sensible margin', () => {
    // Sector 18 to Sector 62 is roughly 7 km apart.
    const km = haversineKm(28.5708, 77.3260, 28.6270, 77.3720)
    expect(km).toBeGreaterThan(5)
    expect(km).toBeLessThan(10)
  })
})

describe('the complaint state machine', () => {
  it('allows the normal path through the lifecycle', () => {
    expect(canTransition(ComplaintStatus.SUBMITTED, ComplaintStatus.ROUTED)).toBe(true)
    expect(canTransition(ComplaintStatus.ROUTED, ComplaintStatus.ASSIGNED)).toBe(true)
    expect(canTransition(ComplaintStatus.ASSIGNED, ComplaintStatus.IN_PROGRESS)).toBe(true)
    expect(canTransition(ComplaintStatus.IN_PROGRESS, ComplaintStatus.AWAITING_VERIFICATION)).toBe(true)
    expect(canTransition(ComplaintStatus.AWAITING_VERIFICATION, ComplaintStatus.RESOLVED)).toBe(true)
    expect(canTransition(ComplaintStatus.RESOLVED, ComplaintStatus.CLOSED)).toBe(true)
  })

  it('lets an officer send unsatisfactory work back to the crew', () => {
    expect(canTransition(ComplaintStatus.AWAITING_VERIFICATION, ComplaintStatus.IN_PROGRESS)).toBe(true)
    expect(canTransition(ComplaintStatus.RESOLVED, ComplaintStatus.IN_PROGRESS)).toBe(true)
  })

  it('refuses to skip the work itself', () => {
    expect(canTransition(ComplaintStatus.ASSIGNED, ComplaintStatus.RESOLVED)).toBe(false)
    expect(canTransition(ComplaintStatus.SUBMITTED, ComplaintStatus.CLOSED)).toBe(false)
  })

  it('treats closed, rejected and duplicate as terminal', () => {
    for (const terminal of [
      ComplaintStatus.CLOSED,
      ComplaintStatus.REJECTED,
      ComplaintStatus.DUPLICATE,
    ]) {
      for (const target of Object.values(ComplaintStatus)) {
        expect(canTransition(terminal, target)).toBe(false)
      }
    }
  })

  it('will not reopen a complaint by going backwards to SUBMITTED', () => {
    for (const from of Object.values(ComplaintStatus)) {
      expect(canTransition(from, ComplaintStatus.SUBMITTED)).toBe(false)
    }
  })
})
