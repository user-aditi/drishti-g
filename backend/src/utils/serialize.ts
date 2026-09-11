import type {
  Agency,
  OrgUnit,
  RequestDescriptor,
  RequestType,
  ServiceRequest,
  User,
} from '@prisma/client'
import { observedNow } from '../config/systemClock.js'

/**
 * What leaves the API, and what never does.
 *
 * Everything a client sees passes through here. The point is not tidiness: it
 * is that `passwordHash` cannot reach a response by someone forgetting a
 * `select`, because no shape defined in this file has a field for it.
 */

type AgencyRef = { id: number; code: string; name: string }

export function publicAgency(agency: Agency): AgencyRef {
  return { id: agency.id, code: agency.code, name: agency.name }
}

export function publicOrgUnit(unit: OrgUnit) {
  return {
    id: unit.id,
    code: unit.code,
    name: unit.name,
    depth: unit.depth,
    kindLabel: unit.kindLabel,
    isLeaf: unit.isLeaf,
    centroidLat: unit.centroidLat,
    centroidLon: unit.centroidLon,
  }
}

export function publicUser(user: User & { agency?: Agency | null; orgUnit?: OrgUnit | null }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    agency: user.agency ? publicAgency(user.agency) : null,
    orgUnit: user.orgUnit ? { id: user.orgUnit.id, code: user.orgUnit.code, name: user.orgUnit.name } : null,
    // Always sent, never optional. Every staff account in this system stands in
    // for a role NYC does not record, and the UI has to be able to say so
    // wherever it shows one. A synthetic account presented as a real person is
    // the one thing this replica must never do.
    isSynthetic: user.isSynthetic,
  }
}

export function publicRequestType(
  type: RequestType & { agency?: Agency | null; descriptors?: RequestDescriptor[] },
) {
  return {
    id: type.id,
    code: type.code,
    name: type.name,
    slaHours: type.slaHours,
    slaSource: type.slaSource,
    // Travels with the SLA rather than beside it. NYC publishes no due date for
    // any of these complaint types, so every deadline here is derived, and a
    // caption that quietly drops the provenance turns a measurement into a claim
    // the City never made.
    slaNote: type.slaNote,
    agency: type.agency ? publicAgency(type.agency) : null,
    descriptors: type.descriptors?.map((d) => ({ id: d.id, name: d.name })) ?? [],
  }
}

type RequestWithRefs = ServiceRequest & {
  type?: (RequestType & { agency?: Agency | null }) | null
  descriptor?: RequestDescriptor | null
  agency?: Agency | null
  orgUnit?: OrgUnit | null
}

/**
 * One service request as the API reports it.
 *
 * `isOverdue` is computed here and never stored, against a reference date the
 * caller supplies rather than against `Date.now()`. That is not a style
 * preference: this corpus ends in December 2025, so a wall-clock comparison
 * marks essentially every imported request overdue, and the same bug in the
 * other direction once produced 2,554 open complaints and zero overdue.
 */
export function publicRequest(request: RequestWithRefs, referenceDate: Date) {
  const dueAt = request.slaDueAt
  // "Open" means NYC's published status is not Closed — the same rule the
  // register, the boards and the map use, so a request is never counted open
  // in one place and closed in another. NYC's own fields disagree on 2,839 rows
  // (2,791 not Closed yet carrying a closed_date, 48 Closed with none); before
  // this rule existed the boards register counted "open" by status and
  // "overdue" by closedAt, so its overdue column was not a subset of its open
  // one (F-27). closedAt is used only for what it measures: when it closed.
  // Judged at the moment the record was observed: NYC's rows at the snapshot,
  // this system's own filings live, against the real clock (F-24).
  const observedAt = observedNow(request.isImported, referenceDate)
  const isOverdue =
    dueAt !== null &&
    (request.status !== 'CLOSED'
      ? observedAt > dueAt
      : request.closedAt !== null && request.closedAt > dueAt)

  return {
    id: request.id,
    srNumber: request.srNumber,
    status: request.status,
    channel: request.channel,
    type: request.type ? { id: request.type.id, code: request.type.code, name: request.type.name } : null,
    descriptor: request.descriptor ? { id: request.descriptor.id, name: request.descriptor.name } : null,
    agency: request.agency ? publicAgency(request.agency) : null,
    orgUnit: request.orgUnit
      ? { id: request.orgUnit.id, code: request.orgUnit.code, name: request.orgUnit.name }
      : null,
    createdAt: request.createdAt,
    closedAt: request.closedAt,
    slaDueAt: request.slaDueAt,
    isOverdue,
    latitude: request.latitude,
    longitude: request.longitude,
    address: request.address,
    zip: request.zip,
    councilDistrict: request.councilDistrict,
    policePrecinct: request.policePrecinct,
    resolutionNote: request.resolutionNote,
    // Load-bearing in the UI, not decoration: an imported row is a historical
    // record of something New York did, and one filed here is something this
    // system did. A citizen looking at a status page should be able to tell.
    isImported: request.isImported,
  }
}
