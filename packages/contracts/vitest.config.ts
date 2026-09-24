import { defineConfig } from 'vitest/config'

/**
 * Vitest config for `packages/contracts` — pure logic, no DOM.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/**/*.test.ts'],
      thresholds: {
        // Contracts are the load-bearing seam
        // (ADR-014/015/016) — hold them at 90% statements.
        statements: 90,
        branches: 80,
        functions: 85,
        lines: 90,
      },
    },
  },
})
