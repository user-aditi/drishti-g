import { defineConfig, devices } from '@playwright/test'

/**
 * End-to-end tests: the product's journeys, driven in a real browser.
 *
 *   npm run e2e          (needs the API on :4000 and the web app on :3000)
 *
 * The API and web app are not started from here. Locally they are usually
 * already running, and in CI the workflow starts them — against a freshly
 * migrated and seeded database, without the imported corpus, which is why every
 * journey creates the data it needs rather than borrowing NYC's.
 *
 * One worker: `next dev` compiles each route on first request, and parallel
 * cold compiles make timings meaningless and flake without telling you why.
 */
export default defineConfig({
    testDir: './e2e',
    globalSetup: './e2e/global-setup.ts',
    timeout: 90_000,
    expect: { timeout: 20_000 },
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        ...devices['Desktop Chrome'],
        baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:3000',
        trace: 'retain-on-failure',
    },
})
