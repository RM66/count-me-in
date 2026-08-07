import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Vitest config for `apps/web` — DOM environment for React component/hook tests.
 * Resolves `@/*` and `@repo/*` aliases, and neutralizes `server-only`.
 */
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    exclude: ['node_modules', '.next', 'dist'],
    setupFiles: ['./vitest.setup.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'vitest.server-only-stub.ts'),
      '@repo/api-contracts': path.resolve(__dirname, '../../packages/api-contracts/src'),
      '@repo/db': path.resolve(__dirname, '../../packages/db/src'),
      '@repo/redis': path.resolve(__dirname, '../../packages/redis/src'),
      '@repo/storage': path.resolve(__dirname, '../../packages/storage/src'),
    },
  },
})
