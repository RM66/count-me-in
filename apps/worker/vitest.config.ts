import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Vitest config for `apps/worker` — pure node environment.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
  resolve: {
    alias: {
      '@repo/api-contracts': path.resolve(__dirname, '../../packages/api-contracts/src'),
      '@repo/db': path.resolve(__dirname, '../../packages/db/src'),
      '@repo/redis': path.resolve(__dirname, '../../packages/redis/src'),
    },
  },
})
