/**
 * Projects Postgres rows into the Neo4j knowledge graph.
 *
 * Postgres stays the system of record. The graph exists so "who is connected to
 * what" is a traversal rather than a join — which is what GCCE needs for routing
 * and GRIE needs to propagate risk from a project to its contractor and ward.
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
      [complaint.wardId, 'Ward', 'OCCURRED_IN'],
      [complaint.departmentId, 'Department', 'OWNED_BY'],
      [complaint.categoryId, 'Category', 'OF_CATEGORY'],
      [complaint.citizenId, 'User', 'FILED_BY'],
      [complaint.assignedToId, 'User', 'ASSIGNED_TO'],
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
  wards: number
  categories: number
  users: number
  contractors: number
  projects: number
  complaints: number
}

/** Rebuild the whole projection from Postgres. Idempotent. */
export async function fullSync(): Promise<SyncCounts> {
  const [departments, wards, categories, users, contractors, projects, complaints] =
    await Promise.all([
      prisma.department.findMany(),
      prisma.ward.findMany(),
      prisma.complaintCategory.findMany(),
      prisma.user.findMany(),
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

    for (const w of wards) {
      await session.run(
        `MERGE (w:Ward {id: $id})
         SET w.number = $number, w.name = $name, w.zone = $zone, w.lat = $lat, w.lon = $lon`,
        { id: w.id, number: w.wardNumber, name: w.name, zone: w.zone, lat: w.centroidLat, lon: w.centroidLon },
      )
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
        'MERGE (u:User {id: $id}) SET u.name = $name, u.role = $role, u.active = $active',
        { id: u.id, name: u.fullName, role: u.role, active: u.isActive },
      )
      // These edges are what make assignee lookup a one-hop traversal.
      if (u.departmentId != null) {
        await link(session, { label: 'User', id: u.id }, { label: 'Department', id: u.departmentId }, 'MEMBER_OF')
      }
      if (u.wardId != null) {
        await link(session, { label: 'User', id: u.id }, { label: 'Ward', id: u.wardId }, 'SERVES')
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
      if (p.wardId != null) {
        await link(session, { label: 'Project', id: p.id }, { label: 'Ward', id: p.wardId }, 'LOCATED_IN')
      }
    }
  })

  for (const c of complaints) await syncComplaint(c.id)

  const counts: SyncCounts = {
    departments: departments.length,
    wards: wards.length,
    categories: categories.length,
    users: users.length,
    contractors: contractors.length,
    projects: projects.length,
    complaints: complaints.length,
  }
  log.info('full sync complete', counts)
  return counts
}
