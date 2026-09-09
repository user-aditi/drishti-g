import { z } from 'zod'

/**
 * A boolean that survives arriving as text.
 *
 * `z.coerce.boolean()` is `Boolean(value)`, and `Boolean('false')` is `true`.
 * Every checkbox posted through a form or a query string arrives as a string,
 * so that coercion turns every "no" into a "yes" — silently, with no validation
 * error to notice.
 *
 * This bit us on the one field where it mattered most: a resident answering
 * "no, the work was not done" had it recorded as a confirmation, closing the
 * complaint they were trying to reopen. The verification design rests entirely
 * on that answer being read correctly.
 */
export const formBoolean = z
  .union([z.boolean(), z.string(), z.number()])
  .transform((value, ctx) => {
    if (typeof value === 'boolean') return value
    if (typeof value === 'number') return value !== 0

    const normalised = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalised)) return true
    if (['false', '0', 'no', 'off', ''].includes(normalised)) return false

    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Expected true or false, received "${value}"`,
    })
    return z.NEVER
  })
