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

  /*
   * Where the system believes it is standing in time.
   *
   * Not validated here on purpose — `systemClock.ts` owns it, reads
   * `process.env` directly, and is used by scripts that run without a JWT
   * secret or an API to serve. This module exits the process when those are
   * missing, so the importer could not import it.
   */
})

const parsed = schema.safeParse(process.env)

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
}
