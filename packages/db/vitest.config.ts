import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Vitest config for `@repo/db` — node environment. Integration tests need a
 * real Postgres (POSTGRES_URL) and skip locally when it is not configured,
 * failing in CI instead.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@repo/contracts': path.resolve(__dirname, '../contracts/src'),
    },
  },
})
