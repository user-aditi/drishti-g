/**
 * Projects Postgres rows into the Neo4j knowledge graph.
 *
 * Postgres stays the system of record. The graph exists so "who is connected to
 * what" is a traversal rather than a join — which is what GCCE needs for routing
 * and GRIE needs to propagate risk from a project to its contractor and sector.
 *
 * Every write is a MERGE, so re-running a sync is safe and the graph can always
 * be rebuilt from Postgres if it drifts.
 */
import type { Session } from 'neo4j-driver'
import { createLogger } from '../lib/logger.js'
import { prisma } from '../lib/prisma.js'
import { withGraph } from '../lib/neo4j.js'

const log = createLogger('graph')

/** Link two nodes by id. The WITH keeps Neo4j from planning a cartesian product. */
async function link(
  session: Session,
  from: { label: string; id: number },
  to: { label: string; id: number },
  rel: string,
): Promise<void> {
  await session.run(
    `MATCH (a:${from.label} {id: $fromId})
     WITH a
     MATCH (b:${to.label} {id: $toId})
     MERGE (a)-[:${rel}]->(b)`,
    { fromId: from.id, toId: to.id },
  )
}

export async function syncComplaint(complaintId: number): Promise<void> {
  const complaint = await prisma.complaint.findUnique({ where: { id: complaintId } })
  if (!complaint) return

  await withGraph(async (session) => {
    await session.run(
      `MERGE (x:Complaint {id: $id})
       SET x.ref = $ref, x.status = $status, x.priority = $priority, x.title = $title`,
      {
        id: complaint.id,
        ref: complaint.referenceNo,
        status: complaint.status,
        priority: complaint.priority,
        title: complaint.title,
      },
    )

    const edges: Array<[number | null, string, string]> = [
      [complaint.sectorId, 'Sector', 'OCCURRED_IN'],
      [complaint.departmentId, 'Department', 'OWNED_BY'],
      [complaint.categoryId, 'Category', 'OF_CATEGORY'],
      [complaint.citizenId, 'User', 'FILED_BY'],
      [complaint.assignedOfficerId, 'User', 'ASSIGNED_TO'],
      [complaint.assignedWorkerId, 'User', 'WORKED_BY'],
    ]
    for (const [targetId, label, rel] of edges) {
      if (targetId == null) continue
      await link(session, { label: 'Complaint', id: complaint.id }, { label, id: targetId }, rel)
    }
  })
}

/**
 * Sync a complaint without blocking the caller.
 *
 * A citizen's submission must not fail because the graph is unreachable —
 * Postgres already holds the truth, and `fullSync` can rebuild the projection.
 */
export function scheduleComplaintSync(complaintId: number): void {
  setImmediate(() => {
    syncComplaint(complaintId).catch((err) =>
      log.warn(`background graph sync for complaint ${complaintId} failed`, err),
    )
  })
}

export interface SyncCounts {
  departments: number
  zones: number
  circles: number
  sectors: number
  postings: number
  categories: number
  users: number
  contractors: number
  projects: number
  complaints: number
}

/** Rebuild the whole projection from Postgres. Idempotent. */
export async function fullSync(): Promise<SyncCounts> {
  const [departments, zones, circles, sectors, categories, users, postings, contractors, projects, complaints] =
    await Promise.all([
      prisma.department.findMany(),
      prisma.zone.findMany(),
      prisma.circle.findMany(),
      prisma.sector.findMany(),
      prisma.complaintCategory.findMany(),
      prisma.user.findMany(),
      prisma.posting.findMany({ where: { endedAt: null } }),
      prisma.contractor.findMany(),
      prisma.project.findMany(),
      prisma.complaint.findMany(),
    ])

  await withGraph(async (session) => {
    for (const d of departments) {
      await session.run('MERGE (d:Department {id: $id}) SET d.code = $code, d.name = $name', {
        id: d.id,
        code: d.code,
        name: d.name,
      })
    }

    for (const z of zones) {
      await session.run('MERGE (z:Zone {id: $id}) SET z.code = $code, z.name = $name', {
        id: z.id,
        code: z.code,
        name: z.name,
      })
    }

    for (const c of circles) {
      await session.run('MERGE (c:Circle {id: $id}) SET c.code = $code, c.name = $name', {
        id: c.id,
        code: c.code,
        name: c.name,
      })
      await link(session, { label: 'Circle', id: c.id }, { label: 'Zone', id: c.zoneId }, 'IN_ZONE')
    }

    for (const s of sectors) {
      await session.run(
        `MERGE (s:Sector {id: $id})
         SET s.number = $number, s.name = $name, s.lat = $lat, s.lon = $lon`,
        { id: s.id, number: s.number, name: s.name, lat: s.centroidLat, lon: s.centroidLon },
      )
      await link(session, { label: 'Sector', id: s.id }, { label: 'Circle', id: s.circleId }, 'IN_CIRCLE')
    }

    for (const c of categories) {
      await session.run(
        'MERGE (c:Category {id: $id}) SET c.code = $code, c.name = $name, c.slaHours = $sla',
        { id: c.id, code: c.code, name: c.name, sla: c.defaultSlaHours },
      )
      await link(session, { label: 'Category', id: c.id }, { label: 'Department', id: c.departmentId }, 'HANDLED_BY')
    }

    for (const u of users) {
      await session.run(
        'MERGE (u:User {id: $id}) SET u.name = $name, u.rank = $rank, u.active = $active',
        { id: u.id, name: u.fullName, rank: u.rank, active: u.isActive },
      )
    }

    // Postings are what connect a person to a department and a patch of the
    // city, so they carry the edges that make "who covers this sector?" a
    // one-hop traversal instead of a filtered scan.
    for (const p of postings) {
      if (p.departmentId != null) {
        await link(
          session,
          { label: 'User', id: p.userId },
          { label: 'Department', id: p.departmentId },
          'MEMBER_OF',
        )
      }
      const area: Array<[number | null, string]> = [
        [p.sectorId, 'Sector'],
        [p.circleId, 'Circle'],
        [p.zoneId, 'Zone'],
      ]
      for (const [id, label] of area) {
        if (id == null) continue
        await link(session, { label: 'User', id: p.userId }, { label, id }, 'SERVES')
      }
    }

    for (const c of contractors) {
      await session.run(
        'MERGE (c:Contractor {id: $id}) SET c.code = $code, c.name = $name, c.blacklisted = $blacklisted',
        { id: c.id, code: c.code, name: c.name, blacklisted: c.isBlacklisted },
      )
    }

    for (const p of projects) {
      await session.run('MERGE (p:Project {id: $id}) SET p.code = $code, p.name = $name', {
        id: p.id,
        code: p.code,
        name: p.name,
      })
      if (p.contractorId != null) {
        await link(session, { label: 'Contractor', id: p.contractorId }, { label: 'Project', id: p.id }, 'EXECUTES')
      }
      if (p.sectorId != null) {
        await link(session, { label: 'Project', id: p.id }, { label: 'Sector', id: p.sectorId }, 'LOCATED_IN')
      }
    }
  })

  for (const c of complaints) await syncComplaint(c.id)

  const counts: SyncCounts = {
    departments: departments.length,
    zones: zones.length,
    circles: circles.length,
    sectors: sectors.length,
    postings: postings.length,
    categories: categories.length,
    users: users.length,
    contractors: contractors.length,
    projects: projects.length,
    complaints: complaints.length,
  }
  log.info('full sync complete', counts)
  return counts
}
