/**
 * Deciding whether work was actually done, with as little human time as possible.
 *
 * The honest limit first: without image understanding, nothing here can tell
 * that a pothole is filled. What it *can* do cheaply and reliably is catch the
 * ways a submission is not what it claims — proof that predates the job, proof
 * recycled from the citizen's own complaint photo or from another job, proof
 * taken kilometres from the sector, nothing submitted at all.
 *
 * So the design does not try to replace the human. It moves the human. Instead
 * of every closure passing across a Junior Engineer's desk — the bottleneck
 * that makes municipal systems rot — the pipeline screens out bad faith
 * automatically and then asks the one person who can actually see the street:
 * the citizen who reported it. The officer is called in only when the citizen
 * disputes the work, or goes quiet on proof that was weak to begin with.
 *
 * Every check states its own weight and contribution, in the same style as
 * GRIE, so a rejected worker can be told exactly what failed.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Prisma, VerificationOutcome, WorkOrderStatus } from '@prisma/client'
import type { PrismaClient } from '@prisma/client'
import { env } from '../config/env.js'
import { distanceMetres } from './exif.js'

/**
 * SHA-256 of a file this system stored, addressed by its public URL.
 *
 * Returns null for anything it cannot read — a missing file must not fail a
 * worker's submission, it just means one check cannot be run.
 */
async function hashOfStoredFile(url: string | null): Promise<string | null> {
  if (!url) return null
  try {
    const name = url.split('/').pop()
    if (!name) return null
    // Never trust the tail of a URL as a path: a crafted photoUrl must not be
    // able to walk out of the upload directory.
    if (name.includes('..') || name.includes('/') || name.includes('\\')) return null
    const bytes = await readFile(path.resolve(process.cwd(), env.UPLOAD_DIR, name))
    return createHash('sha256').update(bytes).digest('hex')
  } catch {
    return null
  }
}

export type Db = PrismaClient | Prisma.TransactionClient

export interface Check {
  check: string
  label: string
  passed: boolean
  /** Points this check can contribute. */
  weight: number
  /** Points it actually contributed. */
  contribution: number
  /** Said in words a worker or a citizen can read. */
  detail: string
}

export interface VerificationResult {
  score: number
  checks: Check[]
  outcome: VerificationOutcome
}

/**
 * How far from a sector's centre a photograph may be taken and still count.
 *
 * Noida sectors are roughly a kilometre across, and a centroid is not a
 * boundary, so this is deliberately loose. It is meant to catch proof shot in
 * another town, not to adjudicate which side of a road someone stood on.
 */
const LOCATION_TOLERANCE_M = 2_500

/** Below this, nobody is asked — the submission is refused outright. */
const REJECT_BELOW = 35

/**
 * At or above this, a silent citizen is taken as assent after the grace period.
 * Below it, the officer is asked instead.
 */
export const TRUST_WITHOUT_CITIZEN = 70

/** How long a citizen has to respond before the system decides without them. */
export const CITIZEN_GRACE_HOURS = 48

/**
 * Run the automated checks over the newest submission on a work order.
 *
 * Returns the score and the working. Does not write anything — the caller
 * decides what to do with it, which keeps this callable from a sweep as well
 * as from the upload path.
 */
export async function assessSubmission(db: Db, workOrderId: number): Promise<VerificationResult> {
  const order = await db.workOrder.findUniqueOrThrow({
    where: { id: workOrderId },
    include: {
      complaint: {
        include: { sector: true },
      },
      submissions: {
        include: { files: true },
        orderBy: { submittedAt: 'desc' },
        take: 1,
      },
    },
  })

  const submission = order.submissions[0] ?? null
  // A selfie says who was standing there, not that anything was fixed, so it is
  // excluded from every check below. Counting it would let a job be closed with
  // a photograph of somebody's face.
  const files = (submission?.files ?? []).filter((f) => !f.isSelfie)
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
    checks.push({
      check,
      label,
      passed,
      weight,
      contribution: Number((weight * fraction).toFixed(1)),
      detail,
    })
  }

  // 1. Something was actually submitted. -------------------------------------
  const images = files.filter((f) => f.kind === 'IMAGE' || f.kind === 'VIDEO')
  add(
    'proof_supplied',
    'Proof was uploaded',
    25,
    images.length > 0,
    images.length > 0
      ? `${images.length} ${images.length === 1 ? 'file' : 'files'} attached.`
      : 'No photograph or video was attached to this submission.',
  )

  // 2. The proof is not the problem photo, or another job's. ------------------
  const hashes = files.map((f) => f.contentHash)
  let recycled: string | null = null

  if (hashes.length > 0) {
    const reusedElsewhere = await db.workFile.findFirst({
      where: {
        contentHash: { in: hashes },
        submission: { workOrderId: { not: workOrderId } },
      },
      include: { submission: { include: { workOrder: true } } },
    })

    if (reusedElsewhere) {
      recycled = `This file was already submitted against job ${reusedElsewhere.submission.workOrder.code}.`
    } else {
      // Re-sending the citizen's own "here is the problem" photo as "here is
      // the finished work" is the single most obvious way to fake a closure,
      // so it is compared by content. The complaint photo carries no stored
      // hash, so it is read and hashed here rather than at upload time — this
      // runs once per submission, against one small file.
      const complaintHash = await hashOfStoredFile(order.complaint.photoUrl)
      if (complaintHash && hashes.includes(complaintHash)) {
        recycled = 'This is the same photograph the resident sent when reporting the problem.'
      }
    }
  }

  add(
    'not_recycled',
    'Proof is new to this job',
    25,
    hashes.length > 0 && recycled == null,
    recycled ?? 'These files have not been submitted against any other job.',
  )

  // 3. It was taken after the job was issued. ---------------------------------
  const captured = files.map((f) => f.capturedAt).filter((d): d is Date => d != null)
  if (captured.length === 0) {
    // Most phones strip EXIF on upload. Silence is not evidence of fraud, so
    // this scores half rather than zero and says why.
    add(
      'fresh_capture',
      'Photograph taken after the job was issued',
      20,
      false,
      'The files carry no capture date, so this could not be checked.',
      0.5,
    )
  } else {
    const newest = new Date(Math.max(...captured.map((d) => d.getTime())))
    const fresh = newest.getTime() >= order.issuedAt.getTime()
    add(
      'fresh_capture',
      'Photograph taken after the job was issued',
      20,
      fresh,
      fresh
        ? `Taken ${newest.toLocaleString('en-IN')}, after the job was issued.`
        : `Taken ${newest.toLocaleString('en-IN')} — before this job existed.`,
    )
  }

  // 4. It was taken near the sector. ------------------------------------------
  const sector = order.complaint.sector
  const located = files.find((f) => f.exifLat != null && f.exifLon != null)

  if (!located || sector?.centroidLat == null || sector.centroidLon == null) {
    add(
      'on_location',
      'Photograph taken in the right sector',
      15,
      false,
      !located
        ? 'The files carry no location, so this could not be checked.'
        : 'This sector has no map centre recorded, so this could not be checked.',
      0.5,
    )
  } else {
    const metres = distanceMetres(
      located.exifLat!,
      located.exifLon!,
      sector.centroidLat,
      sector.centroidLon,
    )
    const near = metres <= LOCATION_TOLERANCE_M
    add(
      'on_location',
      'Photograph taken in the right sector',
      15,
      near,
      near
        ? `Taken about ${(metres / 1000).toFixed(1)} km from the centre of Sector ${sector.number}.`
        : `Taken about ${(metres / 1000).toFixed(1)} km away — well outside Sector ${sector.number}.`,
    )
  }

  // 5. It arrived before the deadline. ----------------------------------------
  const submittedAt = submission?.submittedAt ?? new Date()
  const due = order.complaint.slaDueAt
  if (!due) {
    add('in_time', 'Submitted before the deadline', 15, true, 'No deadline was set for this complaint.')
  } else {
    const inTime = submittedAt.getTime() <= due.getTime()
    add(
      'in_time',
      'Submitted before the deadline',
      15,
      inTime,
      inTime
        ? 'Submitted within the deadline.'
        : `Submitted ${Math.round((submittedAt.getTime() - due.getTime()) / 3_600_000)} hours past the deadline.`,
    )
  }

  const score = Number(checks.reduce((sum, c) => sum + c.contribution, 0).toFixed(1))

  /**
   * Two of these checks are disqualifying rather than merely negative.
   *
   * A missing file and a file already submitted against another job are not
   * weak evidence to be weighed against the rest — they are proof that this is
   * not proof. Sending either to a resident to adjudicate would waste the one
   * scarce thing the design depends on: their willingness to answer. So they
   * refuse the submission outright, whatever the total came to.
   */
  const disqualified = checks.find(
    (c) => (c.check === 'not_recycled' || c.check === 'proof_supplied') && !c.passed,
  )

  const outcome: VerificationOutcome =
    disqualified || score < REJECT_BELOW
      ? VerificationOutcome.REJECTED
      : VerificationOutcome.NEEDS_CITIZEN

  return { score, checks, outcome }
}

/** Persist an assessment against its work order. */
export async function saveVerification(
  db: Db,
  workOrderId: number,
  result: VerificationResult,
) {
  return db.verification.upsert({
    where: { workOrderId },
    create: {
      workOrderId,
      score: result.score,
      checks: result.checks as unknown as Prisma.InputJsonValue,
      outcome: result.outcome,
    },
    update: {
      score: result.score,
      checks: result.checks as unknown as Prisma.InputJsonValue,
      outcome: result.outcome,
    },
  })
}

/**
 * Fold the citizen's verdict into an existing assessment.
 *
 * Their answer outranks every automated check, in both directions: a resident
 * standing in front of the repaired drain knows something no metadata can show,
 * and one standing in front of an unrepaired one knows it just as surely.
 */
export function applyCitizenVerdict(
  result: VerificationResult,
  confirmed: boolean,
): VerificationResult {
  const check: Check = {
    check: 'citizen_verdict',
    label: 'The person who reported it checked',
    passed: confirmed,
    weight: 40,
    contribution: confirmed ? 40 : 0,
    detail: confirmed
      ? 'The citizen who reported the problem confirms the work was done.'
      : 'The citizen who reported the problem says the work was not done.',
  }

  const checks = [...result.checks.filter((c) => c.check !== 'citizen_verdict'), check]
  // Rescaled back onto 0-100 so the number keeps meaning the same thing once
  // the citizen's weight enters the total.
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0)
  const earned = checks.reduce((sum, c) => sum + c.contribution, 0)
  const score = Number(((earned / totalWeight) * 100).toFixed(1))

  return {
    score,
    checks,
    outcome: confirmed ? VerificationOutcome.AUTO_APPROVED : VerificationOutcome.NEEDS_OFFICER,
  }
}

/**
 * Decide the work orders whose citizens never answered.
 *
 * Run on a schedule. Strong proof with a silent citizen closes on its own —
 * asking an officer to adjudicate a well-evidenced job nobody complained about
 * is exactly the busywork this system exists to remove. Weak proof with a
 * silent citizen is the case that genuinely needs a person.
 */
export async function sweepSilentCitizens(db: PrismaClient) {
  const cutoff = new Date(Date.now() - CITIZEN_GRACE_HOURS * 3_600_000)

  const waiting = await db.verification.findMany({
    where: {
      outcome: VerificationOutcome.NEEDS_CITIZEN,
      updatedAt: { lt: cutoff },
      workOrder: { status: WorkOrderStatus.SUBMITTED },
    },
    include: { workOrder: true },
  })

  const decided: { workOrderId: number; outcome: VerificationOutcome }[] = []

  for (const verification of waiting) {
    const outcome =
      verification.score >= TRUST_WITHOUT_CITIZEN
        ? VerificationOutcome.AUTO_APPROVED
        : VerificationOutcome.NEEDS_OFFICER

    await db.verification.update({ where: { id: verification.id }, data: { outcome } })
    decided.push({ workOrderId: verification.workOrderId, outcome })
  }

  return { checked: waiting.length, decided }
}
