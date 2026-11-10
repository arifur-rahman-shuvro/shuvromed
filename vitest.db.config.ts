import { defineConfig } from 'vitest/config'

// Database tests: real PostgreSQL, real migrations, real RLS. Run with `npm run test:db`.
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    // The 20,000-row database timing test is slow: run it on purpose with `npm run test:db:scale`, not on every push.
    exclude: process.env.DB_SCALE ? [] : ['supabase/tests/scale.test.ts', 'node_modules/**'],
    environment: 'node',
    globalSetup: ['./supabase/tests/support/globalSetup.ts'],
    testTimeout: 20000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
})
