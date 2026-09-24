import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Vitest config for `@repo/db` — node environment. The seed snapshot test
 * (src/seed/demo.test.ts) needs a real Postgres (POSTGRES_URL) and skips
 * locally when it is not configured, failing in CI instead.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@repo/contracts': path.resolve(__dirname, '../contracts/src'),
    },
  },
})
