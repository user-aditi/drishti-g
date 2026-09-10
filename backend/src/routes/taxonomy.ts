import { Router } from 'express'
import { prisma } from '../lib/prisma.js'
import { asyncHandler } from '../utils/http.js'
import { publicRequestType } from '../utils/serialize.js'

export const taxonomyRouter: Router = Router()

/**
 * The two-level taxonomy the intake wizard walks: type, then descriptor.
 *
 * Unauthenticated, because filing is unauthenticated and the wizard needs this
 * before anyone has signed in.
 *
 * Every type carries its `slaNote` alongside its `slaHours`. That pairing is
 * enforced here rather than left to the client to remember: NYC publishes no
 * due date for any of these complaint types, so every deadline this system
 * quotes is derived from observed closure times, and a number shown without
 * that sentence reads as a promise the City made.
 */
taxonomyRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const types = await prisma.requestType.findMany({
      include: { agency: true, descriptors: { orderBy: { name: 'asc' } } },
      orderBy: { name: 'asc' },
    })
    res.json(types.map(publicRequestType))
  }),
)
