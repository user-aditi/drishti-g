/**
 * A small borough, built from nothing before each test file.
 *
 * Deliberately not the seed, and definitely not the imported corpus: the seed is
 * a demo and the corpus is 355,430 rows, so a test that depended on either would
 * fail for reasons that have nothing to do with the code under test. This builds
 * the smallest structure that can still express every Layer 0 rule worth
 * testing — two boards so a filter has something to exclude, two agencies so an
 * agent can be refused another agency's request, and one type per agency so
 * routing has a decision to make.
 *
 *   Brooklyn (depth 0)
 *   ├── Community Board 1 (depth 1)
 *   └── Community Board 2 (depth 1)
 */
import { PrismaClient, Role, SlaSource } from '@prisma/client'

export const prisma = new PrismaClient()

export interface Fixture {
  borough: number
  board1: number
  board2: number
  dot: number
  dsny: number
  /** Street Condition, DOT, 110.3h SLA. */
  streetType: number
  /** Missed Collection, DSNY, 159.3h SLA. */
  sanitationType: number
  streetDescriptor: number
  dotAgent: number
  dsnyAgent: number
  citizen: number
}

/**
 * Wipe every table this suite touches, children first.
 *
 * `auditEvent` goes before `user` and that order is not cosmetic: the actor
 * relation is `onDelete: Restrict` precisely so a user deletion can never
 * silently rewrite hashed audit content, so deleting users first would throw.
 */
export async function reset() {
  await prisma.$transaction([
    prisma.requestStatusHistory.deleteMany(),
    prisma.auditEvent.deleteMany(),
    prisma.serviceRequest.deleteMany(),
    prisma.requestDescriptor.deleteMany(),
    prisma.requestType.deleteMany(),
    prisma.user.deleteMany(),
    prisma.orgUnit.deleteMany(),
    prisma.agency.deleteMany(),
  ])
}

async function unit(code: string, name: string, kindLabel: string, parentId: number | null) {
  const parent = parentId ? await prisma.orgUnit.findUniqueOrThrow({ where: { id: parentId } }) : null
  const created = await prisma.orgUnit.create({
    data: {
      code,
      name,
      kindLabel,
      parentId,
      depth: parent ? parent.depth + 1 : 0,
      path: '',
      isLeaf: true,
    },
  })
  // The materialised path can only be written once the row has an id, and the
  // parent stops being a leaf the moment it acquires one.
  const path = `${parent ? parent.path : '/'}${created.id}/`
  await prisma.orgUnit.update({ where: { id: created.id }, data: { path } })
  if (parent) await prisma.orgUnit.update({ where: { id: parent.id }, data: { isLeaf: false } })
  return created.id
}

const SLA_NOTE =
  'Derived: 75th percentile of observed citywide closure time for this type. ' +
  'NYC publishes no due date for this complaint type.'

export async function build(): Promise<Fixture> {
  const borough = await unit('BK', 'Brooklyn', 'Borough', null)
  const board1 = await unit('BK-01', 'Community Board 1', 'Community Board', borough)
  const board2 = await unit('BK-02', 'Community Board 2', 'Community Board', borough)

  const dot = await prisma.agency.create({
    data: { code: 'DOT', name: 'Department of Transportation' },
  })
  const dsny = await prisma.agency.create({
    data: { code: 'DSNY', name: 'Department of Sanitation' },
  })

  const streetType = await prisma.requestType.create({
    data: {
      code: 'street-condition',
      name: 'Street Condition',
      agencyId: dot.id,
      slaHours: 110.3,
      slaSource: SlaSource.DERIVED_P75,
      slaNote: SLA_NOTE,
    },
  })
  const sanitationType = await prisma.requestType.create({
    data: {
      code: 'missed-collection',
      name: 'Missed Collection',
      agencyId: dsny.id,
      slaHours: 159.3,
      slaSource: SlaSource.DERIVED_P75,
      slaNote: SLA_NOTE,
    },
  })

  const streetDescriptor = await prisma.requestDescriptor.create({
    data: { name: 'Pothole', requestTypeId: streetType.id },
  })

  // Every staff account here is synthetic, exactly as in the real system: NYC
  // publishes no case-worker identity, so there is no real person to model.
  const dotAgent = await prisma.user.create({
    data: {
      email: 'dot.agent@example.invalid',
      name: 'DOT Agent',
      passwordHash: 'test-not-a-real-hash',
      role: Role.AGENT,
      agencyId: dot.id,
      isSynthetic: true,
    },
  })
  const dsnyAgent = await prisma.user.create({
    data: {
      email: 'dsny.agent@example.invalid',
      name: 'DSNY Agent',
      passwordHash: 'test-not-a-real-hash',
      role: Role.AGENT,
      agencyId: dsny.id,
      isSynthetic: true,
    },
  })
  const citizen = await prisma.user.create({
    data: {
      email: 'citizen@example.invalid',
      name: 'Test Citizen',
      passwordHash: 'test-not-a-real-hash',
      role: Role.CITIZEN,
      orgUnitId: board1,
    },
  })

  return {
    borough,
    board1,
    board2,
    dot: dot.id,
    dsny: dsny.id,
    streetType: streetType.id,
    sanitationType: sanitationType.id,
    streetDescriptor: streetDescriptor.id,
    dotAgent: dotAgent.id,
    dsnyAgent: dsnyAgent.id,
    citizen: citizen.id,
  }
}
