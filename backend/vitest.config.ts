import { defineConfig } from 'vitest/config'

/**
 * Tests run against a real Postgres database, not a mock.
 *
 * The logic worth testing here — jurisdiction scoping, the escalation walk, a
 * department's operating depth — is all expressed as queries over a tree. A
 * mocked Prisma would only assert that we call the functions we already know we
 * call; it would not have caught either of the scoping bugs this suite exists
 * to prevent.
 *
 * The database is `drishti_g_test`, separate from the dev one and rebuilt by
 * `tests/setup.ts` before each file, so a failing test can never corrupt the
 * demo data.
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
      DATABASE_URL: 'postgresql://drishti:drishti_dev_password@localhost:5432/drishti_g_test',
      JWT_SECRET: 'test-only-secret-not-used-anywhere-real',
    },
  },
})
