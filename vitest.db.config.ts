import { defineConfig } from 'vitest/config'

// Database tests: real PostgreSQL, real migrations, real RLS. Run with `npm run test:db`.
export default defineConfig({
  test: {
    include: ['supabase/tests/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['./supabase/tests/support/globalSetup.ts'],
    testTimeout: 20000,
    hookTimeout: 60000,
    fileParallelism: false,
  },
})
