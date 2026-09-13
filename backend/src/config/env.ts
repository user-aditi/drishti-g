import { existsSync } from 'node:fs'
import path from 'node:path'
import dotenv from 'dotenv'
import { z } from 'zod'

// The repo keeps a single .env at the root, shared by compose and both apps.
// Load the backend's own .env first if present, then fall back to the root one,
// so the API behaves the same whether it is run from ./backend or in a container.
for (const candidate of ['.env', '../.env']) {
  const full = path.resolve(process.cwd(), candidate)
  if (existsSync(full)) dotenv.config({ path: full })
}

/**
 * Fail fast on bad configuration. A server that boots with a missing JWT secret
 * and only discovers it at the first login is worse than one that refuses to
 * start.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  API_PREFIX: z.string().default('/api/v1'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),


  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  ACCESS_TOKEN_TTL: z.string().default('1h'),
  REFRESH_TOKEN_TTL: z.string().default('14d'),

  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  PUBLIC_URL: z.string().default('http://localhost:4000'),
  /// Where the browser app lives.
  APP_URL: z.string().default('http://localhost:3000'),
  /** Layer 2: how often the escalation sweep looks for breached live requests. */
  ESCALATION_SWEEP_MS: z.coerce.number().int().min(10_000).default(300_000),
  /** Layer 4: where photographs sent back from a job are written. */
  UPLOAD_DIR: z.string().default('uploads'),
  /** Layer 4: how long the person who reported it has before the system decides without them. */
  CITIZEN_GRACE_HOURS: z.coerce.number().int().min(1).default(48),
  /** Layer 4: how often the system looks for submissions whose citizen never answered. */
  PROOF_SWEEP_MS: z.coerce.number().int().min(10_000).default(600_000),
  /** Layer 4: days a refused submission's photographs stay on disk before they are removed. */
  REFUSED_PHOTO_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  /** Layer 4: how often the retention sweep runs. Daily is plenty for a rule counted in days. */
  RETENTION_SWEEP_MS: z.coerce.number().int().min(60_000).default(86_400_000),
  /**
   * Whether session cookies are marked Secure. Defaults to on in production.
   * Browsers accept Secure cookies on http://localhost, so a production build
   * run locally still signs in; anywhere else, production means HTTPS.
   */
  COOKIE_SECURE: z.enum(['true', 'false']).optional(),

  /*
   * Where the system believes it is standing in time.
   *
   * Not validated here on purpose — `systemClock.ts` owns it, reads
   * `process.env` directly, and is used by scripts that run without a JWT
   * secret or an API to serve. This module exits the process when those are
   * missing, so the importer could not import it.
   */
})

/*
 * In production the example secret is refused outright. `.env.example` ships a
 * placeholder so development works on a fresh clone, and a production image that
 * booted with it would sign sessions anyone reading the repository could forge.
 */
const guarded = schema.superRefine((config, ctx) => {
  if (config.NODE_ENV !== 'production') return
  if (/CHANGE_ME/i.test(config.JWT_SECRET) || config.JWT_SECRET.length < 32) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['JWT_SECRET'],
      message: 'in production, set a random secret of at least 32 characters (not the example value)',
    })
  }
})

const parsed = guarded.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`)
  console.error(`Invalid environment configuration:\n${issues.join('\n')}`)
  process.exit(1)
}

export const env = {
  ...parsed.data,
  corsOrigins: parsed.data.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean),
  isProduction: parsed.data.NODE_ENV === 'production',
  cookieSecure:
    parsed.data.COOKIE_SECURE === undefined ? parsed.data.NODE_ENV === 'production' : parsed.data.COOKIE_SECURE === 'true',
}
