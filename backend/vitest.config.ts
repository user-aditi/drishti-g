import { defineConfig } from 'vitest/config'

/**
 * Tests run against a real Postgres database, not a mock.
 *
 * The logic worth testing here — the audit chain under concurrency, routing, the
 * register's filters over a real tree — is all expressed as queries. A mocked
 * Prisma would only assert that we call the functions we already know we call;
 * it would not have caught the chain fork that this suite exists to prevent.
 *
 * The database is `drishti_nyc_test`, separate from the dev one and wiped by
 * each file's fixture, so a failing test can never touch the imported corpus.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globals: true,
    // Fixtures share table names, so files must not race each other.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://drishti:drishti_dev_password@localhost:5432/drishti_nyc_test',
      JWT_SECRET: 'test-only-secret-not-used-anywhere-real',
      // Pinned so "overdue" is deterministic. Every date in this system is read
      // against the reference date rather than the wall clock, and a suite that
      // let it drift would pass today and fail tomorrow for no reason anyone
      // could find.
      SYSTEM_REFERENCE_DATE: '2025-12-31T23:11:00.000Z',
    },
  },
})
