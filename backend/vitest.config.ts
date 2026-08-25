import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // The engines are pure functions; nothing here should need a live database.
    globals: true,
  },
})
