/**
 * A small authority, built from nothing before each test file.
 *
 * Deliberately not the seed: the seed is a demo, and a test that depends on it
 * fails for reasons that have nothing to do with the code. This builds the
 * smallest tree that can still express every rule worth testing — two zones so
 * a sibling can be refused, two sectors under one of them so a rollup has
 * something to sum, and two departments operating at different depths.
 *
 *   City (depth 0)
 *   ├── Zone A (depth 1)
 *   │   ├── Sector 1 (depth 2)
 *   │   └── Sector 2 (depth 2)
 *   └── Zone B (depth 1)
 *       └── Sector 3 (depth 2)
 */
import { PrismaClient, Role, Rank, DepartmentStatus } from '@prisma/client'

export const prisma = new PrismaClient()

export interface Fixture {
  city: number
  zoneA: number
  zoneB: number
  sector1: number
  sector2: number
  sector3: number
  /** Runs the full depth of the tree: City -> Zone -> Sector. */
  deepDept: number
  /** Stops at depth 1: City -> Zone. Its ground floor is a zone. */
  shallowDept: number
  cityOfficer: number
  zoneAOfficer: number
  sector1Officer: number
  citizen: number
}

/** Wipe every table this suite touches, children first. */
export async function reset() {
  await prisma.$transaction([
    prisma.escalation.deleteMany(),
    prisma.complaintStatusHistory.deleteMany(),
    prisma.complaintSupport.deleteMany(),
    prisma.notification.deleteMany(),
    prisma.auditEvent.deleteMany(),
    prisma.complaint.deleteMany(),
    prisma.grievanceCluster.deleteMany(),
    prisma.crew.deleteMany(),
    prisma.posting.deleteMany(),
    prisma.departmentLayer.deleteMany(),
    prisma.complaintCategory.deleteMany(),
    prisma.user.deleteMany(),
    prisma.orgUnit.deleteMany(),
    prisma.department.deleteMany(),
  ])
}

async function unit(
  code: string,
  name: string,
  kindLabel: string,
  parent: { id: number; depth: number; path: string } | null,
) {
  const created = await prisma.orgUnit.create({
    data: {
      code,
      name,
      kindLabel,
      depth: parent ? parent.depth + 1 : 0,
      path: 'pending',
      parentId: parent?.id ?? null,
      isLeaf: true,
      centroidLat: 28.5 + Math.random() * 0.1,
      centroidLon: 77.3 + Math.random() * 0.1,
    },
  })
  const path = parent ? `${parent.path}${created.id}/` : `/${created.id}/`
  const withPath = await prisma.orgUnit.update({ where: { id: created.id }, data: { path } })
  if (parent) await prisma.orgUnit.update({ where: { id: parent.id }, data: { isLeaf: false } })
  return withPath
}

async function officer(email: string, name: string, orgUnitId: number, departmentId: number) {
  const user = await prisma.user.create({
    data: {
      email,
      fullName: name,
      hashedPassword: 'test-not-a-real-hash',
      role: Role.OFFICER,
      rank: Rank.SECTION_OFFICER,
    },
  })
  await prisma.posting.create({
    data: {
      userId: user.id,
      departmentId,
      orgUnitId,
      rank: Rank.SECTION_OFFICER,
      level: 'SECTOR',
      designationTitle: name,
    },
  })
  return user.id
}

export async function build(): Promise<Fixture> {
  await reset()

  const city = await unit('CITY', 'Testville', 'City', null)
  const zoneA = await unit('ZA', 'Zone A', 'Zone', city)
  const zoneB = await unit('ZB', 'Zone B', 'Zone', city)
  const sector1 = await unit('S1', 'Sector 1', 'Sector', zoneA)
  const sector2 = await unit('S2', 'Sector 2', 'Sector', zoneA)
  const sector3 = await unit('S3', 'Sector 3', 'Sector', zoneB)

  const deepDept = await prisma.department.create({
    data: { code: 'DEEP', name: 'Deep Department', status: DepartmentStatus.ACTIVE },
  })
  const shallowDept = await prisma.department.create({
    data: { code: 'SHALLOW', name: 'Shallow Department', status: DepartmentStatus.ACTIVE },
  })

  // Deep runs all three layers and dispatches from the sector.
  await prisma.departmentLayer.createMany({
    data: [
      { departmentId: deepDept.id, depth: 0, name: 'City', namePlural: 'City', canDispatch: false, slaHours: 168 },
      { departmentId: deepDept.id, depth: 1, name: 'Zone', namePlural: 'Zones', canDispatch: false, slaHours: 72 },
      { departmentId: deepDept.id, depth: 2, name: 'Sector', namePlural: 'Sectors', canDispatch: true, slaHours: 24 },
    ],
  })

  // Shallow stops at the zone — its ground floor is a unit that HAS children,
  // which is exactly the case that broke dispatch once.
  await prisma.departmentLayer.createMany({
    data: [
      { departmentId: shallowDept.id, depth: 0, name: 'City', namePlural: 'City', canDispatch: false, slaHours: 120 },
      { departmentId: shallowDept.id, depth: 1, name: 'Ward', namePlural: 'Wards', canDispatch: true, slaHours: 36 },
    ],
  })

  const cityOfficer = await officer('city@test.local', 'City Officer', city.id, deepDept.id)
  const zoneAOfficer = await officer('zonea@test.local', 'Zone A Officer', zoneA.id, deepDept.id)
  const sector1Officer = await officer('s1@test.local', 'Sector 1 Officer', sector1.id, deepDept.id)

  const citizen = await prisma.user.create({
    data: {
      email: 'resident@test.local',
      fullName: 'Test Resident',
      hashedPassword: 'test-not-a-real-hash',
      role: Role.CITIZEN,
      rank: Rank.CITIZEN,
      homeUnitId: sector1.id,
    },
  })

  return {
    city: city.id,
    zoneA: zoneA.id,
    zoneB: zoneB.id,
    sector1: sector1.id,
    sector2: sector2.id,
    sector3: sector3.id,
    deepDept: deepDept.id,
    shallowDept: shallowDept.id,
    cityOfficer,
    zoneAOfficer,
    sector1Officer,
    citizen: citizen.id,
  }
}

/** An open complaint sitting at a unit, optionally already past its deadline. */
export async function complaint(
  f: Fixture,
  opts: { unitId: number; departmentId: number; overdueHours?: number; title?: string },
) {
  const due =
    opts.overdueHours != null
      ? new Date(Date.now() - opts.overdueHours * 3_600_000)
      : new Date(Date.now() + 24 * 3_600_000)

  return prisma.complaint.create({
    data: {
      referenceNo: `TEST-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
      title: opts.title ?? 'Broken street light',
      description: 'Test complaint',
      citizenId: f.citizen,
      departmentId: opts.departmentId,
      orgUnitId: opts.unitId,
      status: 'ASSIGNED',
      priority: 'MEDIUM',
      slaDueAt: due,
    },
  })
}
