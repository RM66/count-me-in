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
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'scripts/**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist'],
    setupFiles: ['./vitest.setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: [
        // Not ours to test: shadcn/Radix primitives, Storybook files,
        // test files themselves, type-only modules.
        'src/components/ui/**',
        'src/**/*.stories.*',
        'src/**/*.test.*',
        'src/**/*.d.ts',
        'src/i18n/global.d.ts',
        // Auth.js wiring (thin singletons): config glue whose behavior is
        // pinned by the Go-side session tests and the E2E smoke.
        'src/server/auth/index.ts',
        'src/server/auth/telegram-provider.ts',
      ],
      thresholds: {
        // Gate only the load-bearing TS seams (helpers, the browser wire,
        // the server read layer). The rest of the app (pages, cabinet
        // components) is ungated.
        'src/helpers/**': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        'src/api-client/**': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
        'src/server/**': {
          statements: 70,
          branches: 70,
          functions: 70,
          lines: 70,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      'server-only': path.resolve(__dirname, 'vitest.server-only-stub.ts'),
      '@repo/contracts': path.resolve(__dirname, '../../packages/contracts/src'),
      '@repo/db': path.resolve(__dirname, '../../packages/db/src'),
      '@repo/redis': path.resolve(__dirname, '../../packages/redis/src'),
    },
  },
})
