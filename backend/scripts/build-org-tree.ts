/**
 * Backfill the recursive org tree from the old Zone -> Circle -> Sector tables.
 *
 * The prototype runs three layers: City -> Zone -> Sector. Work circles are
 * dissolved, because the layer count is now a per-department setting rather
 * than a schema fact, and three is the minimum that still shows an escalation
 * travelling more than one hop. Circle Officers are re-posted to the zone that
 * contained their circle, so nobody is lost.
 *
 * Idempotent: safe to run repeatedly. Matches on OrgUnit.code.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const ROOT_CODE = 'NOIDA'

/** Layer names and behaviour every department starts with. */
const DEFAULT_LAYERS = [
  { depth: 0, name: 'City', namePlural: 'City', canDispatch: false, slaHours: 168, minPostings: 1 },
  { depth: 1, name: 'Zone', namePlural: 'Zones', canDispatch: false, slaHours: 72, minPostings: 1 },
  { depth: 2, name: 'Sector', namePlural: 'Sectors', canDispatch: true, slaHours: 48, minPostings: 1 },
]

async function main() {
  console.log('--- building org tree ---')

  // 1. Root -----------------------------------------------------------------
  const root = await prisma.orgUnit.upsert({
    where: { code: ROOT_CODE },
    update: { name: 'Noida', kindLabel: 'City', depth: 0, isLeaf: false },
    create: {
      code: ROOT_CODE,
      name: 'Noida',
      nameHi: 'नोएडा',
      kindLabel: 'City',
      depth: 0,
      path: '/',
      isLeaf: false,
    },
  })
  await prisma.orgUnit.update({ where: { id: root.id }, data: { path: `/${root.id}/` } })
  const rootPath = `/${root.id}/`
  console.log(`root: ${root.name} (id ${root.id})`)

  // 2. Zones ----------------------------------------------------------------
  const zones = await prisma.zone.findMany({ orderBy: { id: 'asc' } })
  const zoneUnitByZoneId = new Map<number, number>()

  for (const zone of zones) {
    const unit = await prisma.orgUnit.upsert({
      where: { code: zone.code },
      update: { name: zone.name, nameHi: zone.nameHi, parentId: root.id, depth: 1, kindLabel: 'Zone', isLeaf: false },
      create: {
        code: zone.code,
        name: zone.name,
        nameHi: zone.nameHi,
        parentId: root.id,
        depth: 1,
        path: 'pending',
        kindLabel: 'Zone',
        isLeaf: false,
      },
    })
    await prisma.orgUnit.update({ where: { id: unit.id }, data: { path: `${rootPath}${unit.id}/` } })
    zoneUnitByZoneId.set(zone.id, unit.id)
  }
  console.log(`zones: ${zones.length}`)

  // 3. Sectors — parented to the zone that owned their circle ---------------
  const sectors = await prisma.sector.findMany({
    include: { circle: true },
    orderBy: { number: 'asc' },
  })
  const sectorUnitBySectorId = new Map<number, number>()

  for (const sector of sectors) {
    const zoneUnitId = zoneUnitByZoneId.get(sector.circle.zoneId)
    if (!zoneUnitId) throw new Error(`sector ${sector.number}: no zone unit for zone ${sector.circle.zoneId}`)

    const code = `SEC-${sector.number}`
    const unit = await prisma.orgUnit.upsert({
      where: { code },
      update: {
        name: sector.name,
        parentId: zoneUnitId,
        depth: 2,
        kindLabel: 'Sector',
        isLeaf: true,
        population: sector.population,
        centroidLat: sector.centroidLat,
        centroidLon: sector.centroidLon,
      },
      create: {
        code,
        name: sector.name,
        parentId: zoneUnitId,
        depth: 2,
        path: 'pending',
        kindLabel: 'Sector',
        isLeaf: true,
        population: sector.population,
        centroidLat: sector.centroidLat,
        centroidLon: sector.centroidLon,
      },
    })
    const zonePath = (await prisma.orgUnit.findUniqueOrThrow({ where: { id: zoneUnitId } })).path
    await prisma.orgUnit.update({ where: { id: unit.id }, data: { path: `${zonePath}${unit.id}/` } })
    sectorUnitBySectorId.set(sector.id, unit.id)
  }
  console.log(`sectors: ${sectors.length}`)

  // 4. Department layers ----------------------------------------------------
  const departments = await prisma.department.findMany()
  for (const dept of departments) {
    for (const layer of DEFAULT_LAYERS) {
      await prisma.departmentLayer.upsert({
        where: { departmentId_depth: { departmentId: dept.id, depth: layer.depth } },
        update: layer,
        create: { departmentId: dept.id, ...layer },
      })
    }
  }
  console.log(`department layers: ${departments.length} departments x ${DEFAULT_LAYERS.length}`)

  // 5. Repoint postings -----------------------------------------------------
  // Circle-level postings move UP to their zone, since circles are dissolved.
  const circles = await prisma.circle.findMany()
  const zoneUnitByCircleId = new Map<number, number>()
  for (const c of circles) {
    const u = zoneUnitByZoneId.get(c.zoneId)
    if (u) zoneUnitByCircleId.set(c.id, u)
  }

  const postings = await prisma.posting.findMany({ where: { endedAt: null } })
  let repointed = 0
  for (const p of postings) {
    let unitId: number | undefined
    if (p.sectorId != null) unitId = sectorUnitBySectorId.get(p.sectorId)
    else if (p.circleId != null) unitId = zoneUnitByCircleId.get(p.circleId)
    else if (p.zoneId != null) unitId = zoneUnitByZoneId.get(p.zoneId)
    else unitId = root.id

    if (unitId && p.orgUnitId !== unitId) {
      await prisma.posting.update({ where: { id: p.id }, data: { orgUnitId: unitId } })
      repointed++
    }
  }
  console.log(`postings repointed: ${repointed}/${postings.length}`)

  // 6. Complaints, citizens, crew -------------------------------------------
  let complaintCount = 0
  for (const [sectorId, unitId] of sectorUnitBySectorId) {
    const r = await prisma.complaint.updateMany({
      where: { sectorId, orgUnitId: null },
      data: { orgUnitId: unitId },
    })
    complaintCount += r.count
  }
  console.log(`complaints placed: ${complaintCount}`)

  let citizenCount = 0
  for (const [sectorId, unitId] of sectorUnitBySectorId) {
    const r = await prisma.user.updateMany({
      where: { homeSectorId: sectorId, homeUnitId: null },
      data: { homeUnitId: unitId },
    })
    citizenCount += r.count
  }
  console.log(`citizens placed: ${citizenCount}`)

  let crewCount = 0
  for (const [sectorId, unitId] of sectorUnitBySectorId) {
    const r = await prisma.crew.updateMany({
      where: { sectorId, orgUnitId: null },
      data: { orgUnitId: unitId },
    })
    crewCount += r.count
  }
  console.log(`crew placed: ${crewCount}`)

  // 7. Integrity ------------------------------------------------------------
  const orphanPostings = await prisma.posting.count({ where: { endedAt: null, orgUnitId: null } })
  const orphanComplaints = await prisma.complaint.count({ where: { orgUnitId: null } })
  console.log(`\nleft unplaced -> postings: ${orphanPostings}, complaints: ${orphanComplaints}`)
  console.log('--- done ---')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
