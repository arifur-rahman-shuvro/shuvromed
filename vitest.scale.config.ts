import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// The 20,000-question test is slow, so it is not part of `npm test`. Run it with `npm run test:scale`.
export default defineConfig({
  resolve: { alias: { 'virtual:pwa-register': fileURLToPath(new URL('./src/test/pwa-register-stub.ts', import.meta.url)) } },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'], include: ['src/scale/**/*.test.ts'], testTimeout: 600000, hookTimeout: 600000 },
})
