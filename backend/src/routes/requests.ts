import { createHash } from 'node:crypto'
import { readFile, unlink } from 'node:fs/promises'
import { Router, type Request } from 'express'
import { Channel, Prisma, RequestStatus, Role, type ServiceRequest } from '@prisma/client'
import sharp from 'sharp'
import { z } from 'zod'
import { referenceDate } from '../config/systemClock.js'
import { signRequestPhotoToken, verifyRequestPhotoToken } from '../lib/auth.js'
import { prisma } from '../lib/prisma.js'
import { authenticate, optionalAuthenticate, requireAgent } from '../middleware/auth.js'
import { acceptPhotos, storedPath } from '../middleware/photos.js'
import { rateLimit } from '../middleware/rateLimit.js'
import { validate } from '../middleware/validate.js'
import * as audit from '../services/audit.js'
import { describeProgress, runFiledHooks } from '../services/requestHooks.js'
import { changeStatus } from '../services/status.js'
import { nextSrNumber, routeRequest } from '../services/routing.js'
import { asyncHandler, badRequest, forbidden, notFound } from '../utils/http.js'
import { publicRequest } from '../utils/serialize.js'
import { invalidateBoards, warmBoards } from './boards.js'

export const requestsRouter: Router = Router()

const REQUEST_INCLUDE = {
  type: { include: { agency: true } },
  descriptor: true,
  agency: true,
  orgUnit: true,
} as const

// ---------------------------------------------------------------------------
// Filing
// ---------------------------------------------------------------------------

const fileSchema = z.object({
  typeId: z.number().int().positive(),
  descriptorId: z.number().int().positive().nullable().optional(),
  orgUnitId: z.number().int().positive().nullable().optional(),
  address: z.string().max(256).optional(),
  zip: z.string().max(16).optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
  channel: z.nativeEnum(Channel).optional(),
})

/**
 * File a request.
 *
 * Unauthenticated on purpose. NYC 311 takes reports from anyone — most of them
 * arrive by telephone from someone with no account at all — and a replica that
 * demanded a login before accepting a pothole report would not be a replica. A
 * signed-in citizen is attributed; everyone else files anonymously.
 */
requestsRouter.post(
  '/',
  // Filing is open to anyone, which is the point; it is not open to a script
  // filing as fast as it can post.
  rateLimit({
    bucket: 'filing',
    windowMs: 60_000,
    max: 20,
    message: 'Too many requests filed from here in the last minute. Wait a moment and try again.',
  }),
  // Anyone may file; a signed-in resident's filing is attributed to them.
  optionalAuthenticate,
  validate(fileSchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof fileSchema>

    // Filed *now*, unlike an imported row, whose timestamp is New York's.
    const filedAt = new Date()

    if (body.descriptorId != null) {
      const descriptor = await prisma.requestDescriptor.findUnique({
        where: { id: body.descriptorId },
        select: { requestTypeId: true },
      })
      if (!descriptor) throw badRequest('That descriptor does not exist')
      if (descriptor.requestTypeId !== body.typeId) {
        throw badRequest('That descriptor does not belong to the chosen request type')
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const routed = await routeRequest(tx, body.typeId, filedAt)
      const srNumber = await nextSrNumber(tx, filedAt)

      const request = await tx.serviceRequest.create({
        data: {
          srNumber,
          citizenId: req.user?.id ?? null,
          typeId: body.typeId,
          descriptorId: body.descriptorId ?? null,
          agencyId: routed.agencyId,
          orgUnitId: body.orgUnitId ?? null,
          status: RequestStatus.OPEN,
          channel: body.channel ?? Channel.ONLINE,
          createdAt: filedAt,
          slaDueAt: routed.slaDueAt,
          address: body.address ?? null,
          zip: body.zip ?? null,
          latitude: body.latitude ?? null,
          longitude: body.longitude ?? null,
          // Ours, not New York's. This flag is what keeps the two populations
          // separable everywhere downstream.
          isImported: false,
        },
        include: REQUEST_INCLUDE,
      })

      await tx.requestStatusHistory.create({
        data: {
          requestId: request.id,
          fromStatus: null,
          toStatus: RequestStatus.OPEN,
          at: filedAt,
          actorId: req.user?.id ?? null,
        },
      })

      await audit.record(tx, {
        action: 'request.filed',
        entityType: 'request',
        entityId: request.id,
        payload: { srNumber, typeId: body.typeId, agencyId: routed.agencyId },
        actorId: req.user?.id ?? null,
        actorLabel: req.user?.name ?? 'anonymous',
      })

      // Whatever a later layer registered, inside this transaction. This route
      // does not know what that is — see services/requestHooks.ts.
      await runFiledHooks(tx, request)

      return request
    })

    // A new request changes its board's volume and backlog. The rollup is
    // cached (see routes/boards.ts), so tell it, and let it recompute now.
    invalidateBoards()
    warmBoards()
    res.status(201).json({
      ...publicRequest(created, referenceDate()),
      // Lets whoever filed attach a photograph in the next hour, account or not.
      photoToken: signRequestPhotoToken(created.id),
    })
  }),
)

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

const SORTS = {
  age: { createdAt: 'asc' },
  newest: { createdAt: 'desc' },
  due: { slaDueAt: 'asc' },
} as const satisfies Record<string, Prisma.ServiceRequestOrderByWithRelationInput>

const listSchema = z.object({
  agencyId: z.coerce.number().int().positive().optional(),
  orgUnitId: z.coerce.number().int().positive().optional(),
  typeId: z.coerce.number().int().positive().optional(),
  status: z.nativeEnum(RequestStatus).optional(),
  /** Open requests only, in any of the not-closed states. */
  openOnly: z.coerce.boolean().optional(),
  overdue: z.coerce.boolean().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  sort: z.enum(['age', 'newest', 'due']).default('age'),
  /** An SR number, or words from the address or descriptor. */
  q: z.string().trim().max(80).optional(),
})

/**
 * The agency queue.
 *
 * Agent-only and always paged. At 350,000 rows the temptation is to fetch and
 * filter in the client, which works fine against a seeded database of two
 * thousand and falls over the first time it meets the real corpus.
 *
 * `overdue` is a filter over `slaDueAt` against the **system reference date** —
 * the snapshot at which NYC's statuses were observed — never `Date.now()`. Asked
 * of the wall clock, every figure on this screen would describe a day the record
 * does not.
 */
requestsRouter.get(
  '/',
  authenticate,
  requireAgent,
  asyncHandler(async (req, res) => {
    const parsed = listSchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Invalid filters', parsed.error.flatten())
    const q = parsed.data
    const now = referenceDate()

    // ANDed as separate conditions, not spread into one object. Three filters
    // constrain `status` — an explicit status, "open only" and "overdue" — and
    // spreading them let the last silently overwrite the first: choosing Pending
    // with "open only" ticked returned every open request of any status.
    const conditions: Prisma.ServiceRequestWhereInput[] = [
      // An agent sees their own agency's work. Agency-level accountability is
      // the whole of Layer 0's access model — there is nothing finer to scope
      // to, because NYC records no individual ownership.
      { agencyId: q.agencyId ?? req.user!.agencyId ?? undefined },
    ]
    if (q.orgUnitId) conditions.push({ orgUnitId: q.orgUnitId })
    if (q.typeId) conditions.push({ typeId: q.typeId })
    if (q.status) conditions.push({ status: q.status })
    if (q.q) {
      // Case-insensitive substring over the three things an agent has in hand
      // when a resident calls back: the number they were given, the street, or
      // what they said the problem was.
      conditions.push({
        OR: [
          { srNumber: { contains: q.q.toUpperCase() } },
          { address: { contains: q.q, mode: 'insensitive' } },
          { descriptor: { name: { contains: q.q, mode: 'insensitive' } } },
        ],
      })
    }
    if (q.openOnly) conditions.push({ status: { not: RequestStatus.CLOSED } })
    // Open by NYC's status, as everywhere else — see publicRequest.
    if (q.overdue) {
      // Each record judged at its own observation time — see observedNow.
      conditions.push({
        status: { not: RequestStatus.CLOSED },
        OR: [
          { isImported: true, slaDueAt: { lt: now } },
          { isImported: false, slaDueAt: { lt: new Date() } },
        ],
      })
    }
    const where: Prisma.ServiceRequestWhereInput = { AND: conditions }

    const [rows, total] = await Promise.all([
      prisma.serviceRequest.findMany({
        where,
        include: REQUEST_INCLUDE,
        orderBy: SORTS[q.sort],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      prisma.serviceRequest.count({ where }),
    ])

    res.json({
      rows: rows.map((r) => publicRequest(r, now)),
      total,
      page: q.page,
      pageSize: q.pageSize,
      referenceDate: now,
    })
  }),
)

// ---------------------------------------------------------------------------
// Before filing: is this already reported?
// ---------------------------------------------------------------------------

const nearbySchema = z.object({
  typeId: z.coerce.number().int().positive(),
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
})

/** How close counts as "the same place": about a block. */
const NEARBY_METRES = 150

/**
 * Open requests of the same type near a point, before someone files another.
 *
 * A hint, never a refusal: two potholes can sit on one block, and a resident is
 * the judge of whether theirs is already reported. What it saves is the common
 * case — the same streetlight reported by six neighbours — and the page that
 * shows it offers the existing request to follow instead.
 *
 * Mounted on a two-segment path so it can never be read as an SR number.
 */
requestsRouter.get(
  '/check/nearby',
  asyncHandler(async (req, res) => {
    const parsed = nearbySchema.safeParse(req.query)
    if (!parsed.success) throw badRequest('Give a type and a point', parsed.error.flatten())
    const { typeId, lat, lng } = parsed.data

    // A bounding box first, then the exact distance.
    const dLat = NEARBY_METRES / 111_320
    const dLng = NEARBY_METRES / (111_320 * Math.cos((lat * Math.PI) / 180))
    const rows = await prisma.$queryRaw<
      { srNumber: string; address: string | null; createdAt: Date; status: RequestStatus; metres: number }[]
    >`
      SELECT "srNumber", address, "createdAt", status,
             6371000 * 2 * ASIN(SQRT(
               POWER(SIN(RADIANS(latitude - ${lat}) / 2), 2) +
               COS(RADIANS(${lat})) * COS(RADIANS(latitude)) * POWER(SIN(RADIANS(longitude - ${lng}) / 2), 2)
             )) AS metres
      FROM service_requests
      WHERE "typeId" = ${typeId}
        AND status <> 'CLOSED'
        AND latitude BETWEEN ${lat - dLat} AND ${lat + dLat}
        AND longitude BETWEEN ${lng - dLng} AND ${lng + dLng}
      ORDER BY metres ASC
      LIMIT 20
    `
    const near = rows.filter((row) => Number(row.metres) <= NEARBY_METRES).slice(0, 5)
    res.json({
      radiusMetres: NEARBY_METRES,
      rows: near.map((row) => ({ ...row, metres: Math.round(Number(row.metres)) })),
    })
  }),
)

// ---------------------------------------------------------------------------
// Photographs of the problem
// ---------------------------------------------------------------------------

const MAX_REQUEST_PHOTOS = 3

/**
 * Who may see a request's photographs: the person who reported it, and staff of
 * the agency handling it. Not the public — a photograph of a street can hold a
 * face or a number plate, and the request page is open to anyone with the number.
 */
function mayViewPhotos(user: Request['user'], request: Pick<ServiceRequest, 'citizenId' | 'agencyId'>): boolean {
  if (!user) return false
  if (request.citizenId !== null && user.id === request.citizenId) return true
  return user.role !== Role.CITIZEN && user.agencyId !== null && user.agencyId === request.agencyId
}

async function findBySr(srNumber: unknown) {
  const request = await prisma.serviceRequest.findUnique({
    where: { srNumber: String(srNumber).trim().toUpperCase() },
  })
  if (!request) throw notFound('No request with that number')
  return request
}

/**
 * Attach photographs to a request just filed.
 *
 * Whoever filed it may: with the photo token the filing returned, which is how
 * someone without an account does it, or as the signed-in resident it belongs to.
 * Three at most in all, and only while the request is open.
 */
requestsRouter.post(
  '/:srNumber/photos',
  rateLimit({
    bucket: 'filing-photos',
    windowMs: 60_000,
    max: 20,
    message: 'Too many photographs sent from here in the last minute. Wait a moment and try again.',
  }),
  optionalAuthenticate,
  acceptPhotos({ prefix: 'request', max: MAX_REQUEST_PHOTOS }),
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? []
    const discard = () => Promise.all(files.map((file) => unlink(file.path).catch(() => undefined)))
    try {
      const request = await findBySr(req.params.srNumber)
      const token = (req.body as { token?: string } | undefined)?.token ?? req.header('x-photo-token') ?? null
      const byToken = token !== null && verifyRequestPhotoToken(token) === request.id
      const byOwner = req.user !== undefined && request.citizenId !== null && req.user.id === request.citizenId
      if (!byToken && !byOwner) throw forbidden('Only whoever filed this request can add photographs to it')
      if (request.status === RequestStatus.CLOSED) throw badRequest('That request is closed')
      if (files.length === 0) throw badRequest('Attach at least one photograph')

      const existing = await prisma.requestPhoto.count({ where: { requestId: request.id } })
      if (existing + files.length > MAX_REQUEST_PHOTOS) {
        throw badRequest(`A request can carry ${MAX_REQUEST_PHOTOS} photographs at most`)
      }

      const rows: Prisma.RequestPhotoCreateManyInput[] = []
      for (const file of files) {
        const bytes = await readFile(file.path)
        let width: number | null = null
        let height: number | null = null
        try {
          const meta = await sharp(bytes).metadata()
          width = meta.width ?? null
          height = meta.height ?? null
        } catch {
          // Undecodable: stored all the same, with its dimensions unknown.
        }
        rows.push({
          requestId: request.id,
          storedName: file.filename,
          mimeType: file.mimetype,
          bytes: file.size,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          width,
          height,
        })
      }

      await prisma.$transaction(async (tx) => {
        await tx.requestPhoto.createMany({ data: rows })
        await audit.record(tx, {
          action: 'request.photos_added',
          entityType: 'request',
          entityId: request.id,
          payload: { srNumber: request.srNumber, count: rows.length, sha256: rows.map((r) => r.sha256) },
          actorId: req.user?.id ?? null,
          actorLabel: req.user?.name ?? 'anonymous',
        })
      })
      res.status(201).json({ ok: true, count: existing + rows.length })
    } catch (err) {
      await discard()
      throw err
    }
  }),
)

/** The photographs on a request, for someone allowed to see them. */
requestsRouter.get(
  '/:srNumber/photos',
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const request = await findBySr(req.params.srNumber)
    if (!mayViewPhotos(req.user, request)) throw forbidden('These photographs are not public')
    const photos = await prisma.requestPhoto.findMany({
      where: { requestId: request.id },
      orderBy: { uploadedAt: 'asc' },
      select: { id: true, mimeType: true, width: true, height: true, uploadedAt: true },
    })
    res.json({ srNumber: request.srNumber, photos })
  }),
)

requestsRouter.get(
  '/:srNumber/photos/:photoId',
  optionalAuthenticate,
  asyncHandler(async (req, res) => {
    const request = await findBySr(req.params.srNumber)
    if (!mayViewPhotos(req.user, request)) throw forbidden('These photographs are not public')
    const photo = await prisma.requestPhoto.findFirst({
      where: { id: Number(req.params.photoId) || -1, requestId: request.id },
    })
    if (!photo) throw notFound('No such photograph')
    let bytes: Buffer
    try {
      bytes = await readFile(storedPath(photo.storedName))
    } catch {
      throw notFound('That photograph is no longer stored')
    }
    // The app runs on another origin; who may fetch this was decided above.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin')
    res.setHeader('Cache-Control', 'private, max-age=300')
    res.type(photo.mimeType).send(bytes)
  }),
)

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/**
 * What has happened to a request, step by step, for the public request page.
 *
 * The baseline knows two steps, filed and closed; everything between comes from
 * whichever later layers registered to describe it (see requestHooks). Public,
 * like the page, so every step is described by role and never by name.
 */
requestsRouter.get(
  '/:srNumber/progress',
  asyncHandler(async (req, res) => {
    const request = await findBySr(req.params.srNumber)
    const steps = [
      { key: 'filed', label: 'Filed', at: request.createdAt, detail: null },
      ...(await describeProgress(prisma, request)),
      ...(request.status === RequestStatus.CLOSED && request.closedAt
        ? [{ key: 'closed', label: 'Closed', at: request.closedAt, detail: request.resolutionNote }]
        : []),
    ]
    res.json({ srNumber: request.srNumber, status: request.status, steps })
  }),
)

// ---------------------------------------------------------------------------
// Lookup and detail
// ---------------------------------------------------------------------------

/**
 * Public lookup by SR number. No authentication.
 *
 * NYC lets anyone check any service request by its number, and so do we. It is
 * also the single best demonstration that this system is running on real data:
 * any of the 355,430 imported numbers resolves.
 */
requestsRouter.get(
  '/:srNumber',
  asyncHandler(async (req, res) => {
    const srNumber = String(req.params.srNumber).trim().toUpperCase()
    const request = await prisma.serviceRequest.findUnique({
      where: { srNumber },
      include: REQUEST_INCLUDE,
    })
    if (!request) throw notFound('No request with that number')

    const [history, photoCount] = await Promise.all([
      prisma.requestStatusHistory.findMany({
        where: { requestId: request.id },
        orderBy: { at: 'asc' },
        select: { id: true, fromStatus: true, toStatus: true, at: true, note: true },
      }),
      prisma.requestPhoto.count({ where: { requestId: request.id } }),
    ])

    res.json({
      ...publicRequest(request, referenceDate()),
      // One entry for an imported request: its arrival in the state NYC last
      // published. NYC publishes no status history, and inventing the steps in
      // between would be manufacturing a record of work nobody did.
      history,
      // How many, not the photographs: those are for the reporter and the agency.
      photoCount,
      slaNote: request.type?.slaNote ?? null,
    })
  }),
)

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

const statusSchema = z.object({
  status: z.nativeEnum(RequestStatus),
  note: z.string().max(2000).optional(),
})

/**
 * Move a request to a new status.
 *
 * Writes history and an audit entry in the same transaction as the update, so a
 * status the register shows always has a corresponding entry in the chain.
 */
requestsRouter.patch(
  '/:id/status',
  authenticate,
  requireAgent,
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id)) throw badRequest('Invalid request id')
    const body = req.body as z.infer<typeof statusSchema>
    const updated = await prisma.$transaction(async (tx) => {
      const existing = await tx.serviceRequest.findUnique({
        where: { id },
        select: { agencyId: true },
      })
      if (!existing) throw notFound('No such request')
      if (req.user!.agencyId !== null && existing.agencyId !== req.user!.agencyId) {
        throw forbidden('That request belongs to another agency')
      }
      await changeStatus(tx, {
        requestId: id,
        status: body.status,
        note: body.note,
        actorId: req.user!.id,
        actorLabel: req.user!.name,
      })
      return tx.serviceRequest.findUniqueOrThrow({ where: { id }, include: REQUEST_INCLUDE })
    })

    // Closing or reopening moves a request between open and closed on its
    // board, so the cached rollup is now wrong until it recomputes.
    invalidateBoards()
    warmBoards()
    res.json(publicRequest(updated, referenceDate()))
  }),
)

/** A citizen's own requests. */
requestsRouter.get(
  '/mine/list',
  authenticate,
  asyncHandler(async (req, res) => {
    const rows = await prisma.serviceRequest.findMany({
      where: { citizenId: req.user!.id },
      include: REQUEST_INCLUDE,
      orderBy: { createdAt: 'desc' },
      take: 200,
    })
    const now = referenceDate()
    res.json({ rows: rows.map((r) => publicRequest(r, now)), total: rows.length })
  }),
)
