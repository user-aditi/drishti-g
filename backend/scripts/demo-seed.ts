/**
 * Live scenarios, so the layers can be shown on demand.
 *
 *   npm run demo:seed
 *
 * The imported corpus is history: nothing in it breaches, escalates or waits on a
 * resident. A request filed through the app only breaches days later (F-37). So
 * showing Layers 2 and 4 — or an officer closing a request — used to mean waiting
 * on the calendar. This creates a small set of live requests already in the
 * states worth showing.
 *
 * Every one says DEMO in its address, is filed on DOT's BK-04 board, and is
 * recorded on the audit chain as demo data, so none can be mistaken for NYC's
 * record or for someone's real report. Their timestamps are set in the past on
 * purpose — that is the point of a demo that cannot wait a week — and the chain
 * entry says so.
 *
 * Nothing is deleted. Each run adds a fresh set, with freshly generated
 * photographs, so a second run is not refused as a recycled photograph.
 *
 *   1. breached   — past its derived deadline: the sweep takes it to the supervisor
 *   2. far past   — past twice its service level: the sweep takes it to the commissioner
 *   3. resident   — the seeded resident reported it; a crew sent a photograph; waiting on the resident
 *   4. no one     — reported anonymously; a crew sent a photograph; in the officer's Work to check
 *   5. confirmed  — the resident confirmed the crew's work; ready for the officer to close
 */
import { randomInt } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { Channel, ProofOutcome, RequestStatus, type Prisma, type ServiceRequest } from '@prisma/client'
import sharp from 'sharp'
import { prisma } from '../src/lib/prisma.js'
import { storedPath } from '../src/middleware/upload.js'
import { assignOnFiling } from '../src/services/assignment.js'
import * as audit from '../src/services/audit.js'
import { sweep } from '../src/services/escalation.js'
import { assess, save, withCitizenVerdict } from '../src/services/proof.js'
import { identify } from '../src/services/proofImage.js'
import { nextSrNumber } from '../src/services/routing.js'
import { CODE_TTL_DAYS, generateCode } from '../src/services/workOrder.js'

const HOUR = 3_600_000
const DAY = 24 * HOUR
const LABEL = 'demo seed'

/** Near Knickerbocker Avenue, inside Community Board 4. */
const SITE = { latitude: 40.6985, longitude: -73.929 }

async function refs() {
  const [agency, board, type, resident] = await Promise.all([
    prisma.agency.findUniqueOrThrow({ where: { code: 'DOT' } }),
    prisma.orgUnit.findFirstOrThrow({ where: { code: 'BK-04' } }),
    prisma.requestType.findFirstOrThrow({ where: { name: 'Street Condition' } }),
    prisma.user.findUniqueOrThrow({ where: { email: 'resident@synthetic.drishti.invalid' } }),
  ])
  return { agency, board, type, resident }
}

type Refs = Awaited<ReturnType<typeof refs>>

/** A live request, filed `ageMs` ago and assigned by the ordinary filing rule. */
async function file(r: Refs, scenario: string, ageMs: number, citizenId: number | null) {
  const createdAt = new Date(Date.now() - ageMs)
  return prisma.$transaction(async (tx) => {
    const srNumber = await nextSrNumber(tx, createdAt)
    const request = await tx.serviceRequest.create({
      data: {
        srNumber,
        citizenId,
        typeId: r.type.id,
        agencyId: r.agency.id,
        orgUnitId: r.board.id,
        status: RequestStatus.OPEN,
        channel: Channel.ONLINE,
        createdAt,
        slaDueAt: new Date(createdAt.getTime() + r.type.slaHours * HOUR),
        address: `DEMO — ${scenario} — 100 KNICKERBOCKER AVENUE`,
        latitude: SITE.latitude,
        longitude: SITE.longitude,
        isImported: false,
      },
    })
    await tx.requestStatusHistory.create({
      data: { requestId: request.id, fromStatus: null, toStatus: RequestStatus.OPEN, at: createdAt, actorId: citizenId },
    })
    await audit.record(tx, {
      action: 'request.filed',
      entityType: 'request',
      entityId: request.id,
      payload: { srNumber, demo: true, scenario, backdatedTo: createdAt.toISOString() },
      actorId: citizenId,
      actorLabel: LABEL,
      source: 'system',
    })
    await assignOnFiling(tx, request)
    // Re-read: the filing rule wrote the assignment to the database, and the
    // object created above predates it.
    return tx.serviceRequest.findUniqueOrThrow({ where: { id: request.id } })
  })
}

/** A flat, generated photograph — unique on every run, and carrying no EXIF. */
async function photograph(): Promise<Buffer> {
  const size = 480
  const pixels = Buffer.alloc(size * size * 3)
  const a = randomInt(1, 250)
  const b = randomInt(1, 250)
  const c = randomInt(1, 250)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 3
      pixels[i] = (x * a + y) % 256
      pixels[i + 1] = (y * b + x) % 256
      pixels[i + 2] = ((x ^ y) * c) % 256
    }
  }
  return sharp(pixels, { raw: { width: size, height: size, channels: 3 } }).jpeg({ quality: 85 }).toBuffer()
}

/** A job sent out, reported done with a photograph, and assessed. */
async function jobDone(request: ServiceRequest, note: string) {
  const officerId = request.assignedOfficerId
  if (!officerId) throw new Error(`${request.srNumber} was not assigned — is the BK-04 officer seeded?`)
  const issuedAt = new Date(Date.now() - 3 * HOUR)
  const completedAt = new Date(Date.now() - HOUR)

  const order = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.workOrder.create({
      data: {
        requestId: request.id,
        issuedById: officerId,
        code: await generateCode(tx),
        instructions: 'Demo job.',
        issuedAt,
        expiresAt: new Date(issuedAt.getTime() + CODE_TTL_DAYS * DAY),
        completedAt,
        completionNote: note,
      },
    })
    await audit.record(tx, {
      action: 'work_order.completed',
      entityType: 'work_order',
      entityId: created.id,
      payload: { code: created.code, srNumber: request.srNumber, demo: true },
      actorId: null,
      actorLabel: LABEL,
      source: 'system',
    })
    return created
  })

  const bytes = await photograph()
  const storedName = `proof-demo-${Date.now()}-${randomInt(1e9)}.jpg`
  await writeFile(storedPath(storedName), bytes)
  const identity = await identify(bytes)
  await prisma.workPhoto.create({
    data: {
      workOrderId: order.id,
      storedName,
      mimeType: 'image/jpeg',
      bytes: bytes.length,
      sha256: identity.sha256,
      dHash: identity.dHash,
      width: identity.width,
      height: identity.height,
      uploadedAt: completedAt,
    },
  })

  const assessment = await assess(prisma, order.id)
  await save(prisma, order.id, assessment)
  return { order, assessment }
}

async function main() {
  const r = await refs()
  const service = r.type.slaHours * HOUR

  const breached = await file(r, 'breached', service + 2 * HOUR, null)
  const farPast = await file(r, 'far past', 2 * service + 2 * HOUR, null)

  const residents = await file(r, 'waiting on the resident', 6 * HOUR, r.resident.id)
  await jobDone(residents, 'Patched and rolled; kerb line repainted.')

  const anonymous = await file(r, 'in the officer’s queue', 6 * HOUR, null)
  await jobDone(anonymous, 'Filled the pothole; no resident on record to ask.')

  const confirmed = await file(r, 'confirmed, ready to close', 8 * HOUR, r.resident.id)
  const done = await jobDone(confirmed, 'Resurfaced the lane and swept up.')
  const verdict = withCitizenVerdict(done.assessment, true)
  await prisma.workProof.update({
    where: { workOrderId: done.order.id },
    data: {
      score: verdict.score,
      checks: verdict.checks as unknown as Prisma.InputJsonValue,
      outcome: ProofOutcome.CONFIRMED,
      citizenVerdict: true,
      citizenAt: new Date(),
    },
  })

  const climbed = await sweep(prisma)
  await audit.record(prisma, {
    action: 'demo.seeded',
    entityType: 'system',
    entityId: 0,
    payload: {
      requests: [breached, farPast, residents, anonymous, confirmed].map((q) => q.srNumber),
      note: 'Demo data: backdated live requests, generated photographs. Not NYC records, not real reports.',
    },
    actorLabel: LABEL,
    source: 'system',
  })

  console.log('Demo scenarios created, all on DOT · BK-04 and labelled DEMO:\n')
  console.log(`  ${breached.srNumber}  past its deadline — Escalations, as dot.supervisor`)
  console.log(`  ${farPast.srNumber}  past twice its service level — Escalations, as dot.commissioner`)
  console.log(`  ${residents.srNumber}  waiting on the resident — My requests, as resident`)
  console.log(`  ${anonymous.srNumber}  no one to ask — Work to check, as dot.officer.bk04`)
  console.log(`  ${confirmed.srNumber}  confirmed by the resident — close it from the officer's request page`)
  console.log(`\nThe escalation sweep climbed ${climbed.rungs} rung(s) across ${climbed.requests} request(s).`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
