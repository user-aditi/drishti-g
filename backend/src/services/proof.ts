/**
 * Deciding what a photograph proves. Layer 4 — NYC 311 has nothing like it.
 *
 * The honest limit first: nothing here can tell that a pothole is filled. No
 * check in this file looks at what the picture shows. What they can tell is
 * that a submission is not what it claims — nothing attached, a photograph
 * already sent against another job, one taken before the job existed, one taken
 * somewhere else — and that is most of what fraud looks like in the field.
 *
 * So the design does not replace the person who can see the street. It picks
 * the right one. The machine screens out bad faith, then asks the resident who
 * reported the problem, whose answer outranks every check here in both
 * directions. The officer is called in only when that answer is disputed, or
 * when the proof was weak and nobody vouched for it. Routing every closure
 * across an officer's desk is the bottleneck that makes these systems rot.
 *
 * Each check states its weight and what it contributed, in the same shape as
 * GRIE's factors, so a crew whose submission is refused can be told exactly
 * which check failed and why.
 */
import { ProofOutcome, type Prisma, type PrismaClient } from '@prisma/client'
import { env } from '../config/env.js'
import { distanceMetres } from './exif.js'
import { hamming } from './proofImage.js'
import { loadSpec, type SpecEnvelope } from './modelSpec.js'

type Db = PrismaClient | Prisma.TransactionClient

/** Bump with CONTRACT in the measurement script when the hash changes shape. */
export const PROOF_CONTRACT = 'proof-dhash/1'

export interface ProofSpec extends SpecEnvelope {
  /** Bits that may differ before two photographs are called the same one. */
  threshold: number
  measurement: {
    photographs: number
    pairs: number
    falseMatches: number
    falseMatchRate: number
    transforms: Record<string, number>
    caughtOverall: number
  }
  dataset: { name: string; doi: string; licence: string }
}

export const proofSpec = (): ProofSpec | null => loadSpec<ProofSpec>('proof-spec.json', PROOF_CONTRACT)

/**
 * How far from the reported location a photograph may be taken.
 *
 * Loose on purpose. NYC's coordinates are the address the request was filed
 * against, a phone's fix drifts, and the crew stands across the road from the
 * pothole. This is meant to catch a photograph taken in another borough, not to
 * adjudicate which side of a street somebody stood on.
 */
const LOCATION_TOLERANCE_M = 500

/** Below this, nobody is asked: the submission is refused outright. */
const REJECT_BELOW = 35

/** At or above this, a silent resident is taken as assent once the grace period is up. */
export const TRUST_WITHOUT_CITIZEN = 70

export interface Check {
  check: string
  label: string
  passed: boolean
  /** Points this check can contribute. */
  weight: number
  /** Points it actually contributed. */
  contribution: number
  /** Said in words a crew or a resident can read. */
  detail: string
}

export interface Assessment {
  score: number
  checks: Check[]
  outcome: ProofOutcome
}

const hours = (ms: number) => Math.round(ms / 3_600_000)

/**
 * Run the checks over one work order's photographs.
 *
 * Writes nothing: the caller decides what to do with the verdict, which keeps
 * this callable from the upload path and from a test alike.
 */
export async function assess(db: Db, workOrderId: number): Promise<Assessment> {
  const order = await db.workOrder.findUniqueOrThrow({
    where: { id: workOrderId },
    include: {
      photos: true,
      request: { select: { citizenId: true, latitude: true, longitude: true, slaDueAt: true } },
    },
  })

  const checks: Check[] = []
  const add = (
    check: string,
    label: string,
    weight: number,
    passed: boolean,
    detail: string,
    /** Partial credit, where a check is inconclusive rather than failed. */
    fraction = passed ? 1 : 0,
  ) => {
    checks.push({ check, label, passed, weight, contribution: Number((weight * fraction).toFixed(1)), detail })
  }

  const photos = order.photos

  // 1. Something was actually sent. -------------------------------------------
  add(
    'proof_supplied',
    'A photograph was sent',
    25,
    photos.length > 0,
    photos.length > 0
      ? `${photos.length} ${photos.length === 1 ? 'photograph' : 'photographs'} attached.`
      : 'Nothing was attached to this submission.',
  )

  // 2. It has not been sent before. -------------------------------------------
  //
  // Two ways to be the same photograph. The exact hash catches the same file;
  // the perceptual hash catches it re-encoded, resized or cropped, which is what
  // happens the moment a picture is shared through a gallery app. The perceptual
  // threshold is a measured number and travels in its own spec — without it, this
  // check still runs, on exact identity alone, and says so.
  const spec = proofSpec()
  let recycled: string | null = null
  let comparedPerceptually = false

  if (photos.length > 0) {
    const elsewhere = await db.workPhoto.findMany({
      where: { workOrderId: { not: workOrderId } },
      select: { sha256: true, dHash: true, workOrder: { select: { code: true } } },
    })
    const mine = new Set(photos.map((p) => p.sha256))
    const exact = elsewhere.find((other) => mine.has(other.sha256))
    if (exact) {
      recycled = `This is the same file already sent against job ${exact.workOrder.code}.`
    } else if (spec) {
      for (const photo of photos) {
        if (!photo.dHash) continue
        const near = elsewhere.find((other) => {
          const distance = hamming(photo.dHash, other.dHash)
          return distance !== null && distance <= spec.threshold
        })
        comparedPerceptually = true
        if (near) {
          recycled = `This is the same photograph already sent against job ${near.workOrder.code}, saved again.`
          break
        }
      }
    }
  }

  add(
    'not_recycled',
    'The photograph is new to this job',
    25,
    photos.length > 0 && recycled == null,
    recycled ??
      (photos.length === 0
        ? 'There is nothing to compare.'
        : comparedPerceptually
          ? 'No job has been sent this photograph before, including re-saved copies of it.'
          : 'No job has been sent these exact files before. Re-saved copies are not compared: no measured threshold is loaded.'),
  )

  // 3. It was taken after the job was issued. ---------------------------------
  const captured = photos.map((p) => p.capturedAt).filter((d): d is Date => d != null)
  if (captured.length === 0) {
    // Most phones strip EXIF, and every browser upload of a re-saved file does.
    // Silence is not evidence of fraud, so this scores half and says why.
    add(
      'fresh_capture',
      'Taken after the job was sent out',
      20,
      false,
      'The photographs carry no capture time, so this could not be checked.',
      0.5,
    )
  } else {
    const newest = new Date(Math.max(...captured.map((d) => d.getTime())))
    const fresh = newest.getTime() >= order.issuedAt.getTime()
    add(
      'fresh_capture',
      'Taken after the job was sent out',
      20,
      fresh,
      fresh
        ? `Taken ${newest.toISOString().slice(0, 16).replace('T', ' ')}, after the job was sent out.`
        : `Taken ${newest.toISOString().slice(0, 16).replace('T', ' ')} — ${hours(order.issuedAt.getTime() - newest.getTime())} hours before this job existed.`,
    )
  }

  // 4. It was taken at the place the request is about. ------------------------
  const located = photos.find((p) => p.exifLat != null && p.exifLng != null)
  const site = order.request
  if (!located || site.latitude == null || site.longitude == null) {
    add(
      'on_location',
      'Taken at the reported location',
      15,
      false,
      !located
        ? 'The photographs carry no location, so this could not be checked.'
        : 'This request has no coordinates on record, so this could not be checked.',
      0.5,
    )
  } else {
    const metres = distanceMetres(located.exifLat!, located.exifLng!, site.latitude, site.longitude)
    const near = metres <= LOCATION_TOLERANCE_M
    add(
      'on_location',
      'Taken at the reported location',
      15,
      near,
      near
        ? `Taken about ${Math.round(metres)} m from where the request was reported.`
        : `Taken about ${(metres / 1000).toFixed(1)} km from where the request was reported.`,
    )
  }

  // 5. It arrived before the derived deadline. --------------------------------
  const now = new Date()
  if (!site.slaDueAt) {
    add('in_time', 'Sent before the deadline', 15, true, 'This request has no deadline on record.')
  } else {
    const inTime = now.getTime() <= site.slaDueAt.getTime()
    add(
      'in_time',
      'Sent before the deadline',
      15,
      inTime,
      inTime
        ? 'Sent within the deadline this project derives for the type — NYC publishes none.'
        : `Sent ${hours(now.getTime() - site.slaDueAt.getTime())} hours past the derived deadline.`,
    )
  }

  const score = Number(checks.reduce((sum, c) => sum + c.contribution, 0).toFixed(1))

  /*
   * Two of these are disqualifying rather than merely negative.
   *
   * Nothing attached, and a photograph already sent against another job, are
   * not weak evidence to be weighed against the rest — they are evidence that
   * this is not proof. Sending either to a resident to adjudicate would spend
   * the scarcest thing this design depends on: their willingness to answer.
   */
  const disqualified = checks.some(
    (c) => (c.check === 'not_recycled' || c.check === 'proof_supplied') && !c.passed,
  )

  const outcome = disqualified || score < REJECT_BELOW
    ? ProofOutcome.REJECTED
    : // Nobody to ask: NYC takes most reports by telephone, and this replica
      // files anonymously too. Then the officer is the only person who can look.
      site.citizenId == null
      ? ProofOutcome.NEEDS_OFFICER
      : ProofOutcome.NEEDS_CITIZEN

  return { score, checks, outcome }
}

/** Store an assessment against its work order. */
export function save(db: Db, workOrderId: number, result: Assessment) {
  const data = {
    score: result.score,
    checks: result.checks as unknown as Prisma.InputJsonValue,
    outcome: result.outcome,
  }
  return db.workProof.upsert({
    where: { workOrderId },
    create: { workOrderId, ...data },
    update: data,
  })
}

/**
 * Fold the resident's verdict into an assessment.
 *
 * It outranks every automated check in both directions: someone standing in
 * front of the repaired road knows something no metadata can show, and someone
 * standing in front of an unrepaired one knows it just as surely.
 */
export function withCitizenVerdict(result: Assessment, confirmed: boolean): Assessment {
  const check: Check = {
    check: 'citizen_verdict',
    label: 'The person who reported it looked',
    passed: confirmed,
    weight: 40,
    contribution: confirmed ? 40 : 0,
    detail: confirmed
      ? 'The resident who reported the problem says the work was done.'
      : 'The resident who reported the problem says the work was not done.',
  }
  const checks = [...result.checks.filter((c) => c.check !== 'citizen_verdict'), check]
  // Rescaled onto 0-100 so the number keeps meaning the same thing once the
  // resident's weight is in the total.
  const weight = checks.reduce((sum, c) => sum + c.weight, 0)
  const earned = checks.reduce((sum, c) => sum + c.contribution, 0)
  return {
    score: Number(((earned / weight) * 100).toFixed(1)),
    checks,
    outcome: confirmed ? ProofOutcome.CONFIRMED : ProofOutcome.NEEDS_OFFICER,
  }
}

/**
 * Decide the submissions whose resident never answered.
 *
 * Strong proof that nobody disputed is confirmed: asking an officer to
 * adjudicate a well-evidenced job no one complained about is exactly the
 * busywork this layer exists to remove. Weak proof with a silent resident is
 * the case that genuinely needs a person.
 */
export async function sweepSilentCitizens(db: PrismaClient, now: Date = new Date()) {
  const cutoff = new Date(now.getTime() - env.CITIZEN_GRACE_HOURS * 3_600_000)
  const waiting = await db.workProof.findMany({
    where: { outcome: ProofOutcome.NEEDS_CITIZEN, updatedAt: { lt: cutoff } },
    select: { id: true, workOrderId: true, score: true },
  })

  let confirmed = 0
  for (const proof of waiting) {
    const outcome =
      proof.score >= TRUST_WITHOUT_CITIZEN ? ProofOutcome.CONFIRMED : ProofOutcome.NEEDS_OFFICER
    if (outcome === ProofOutcome.CONFIRMED) confirmed++
    await db.workProof.update({ where: { id: proof.id }, data: { outcome } })
  }
  return { considered: waiting.length, confirmed, toOfficer: waiting.length - confirmed }
}

/**
 * Run the silent-resident sweep on a timer. Returns a stop function.
 *
 * Same shape as Layer 2's sweep, and for the same reasons: never overlapping
 * itself, and owned by the running process rather than by the app that every
 * test file composes afresh.
 */
export function startProofSweep(
  db: PrismaClient,
  intervalMs: number,
  log: (message: string) => void,
): () => void {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const result = await sweepSilentCitizens(db)
      if (result.considered > 0) {
        log(
          `proof sweep: ${result.considered} submission(s) past the grace period — ` +
            `${result.confirmed} confirmed, ${result.toOfficer} sent to an officer`,
        )
      }
    } catch (err) {
      log(`proof sweep failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), intervalMs)
  void tick()
  return () => clearInterval(timer)
}
