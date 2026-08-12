import { defineConfig } from 'vitest/config'

/**
 * Base Vitest config for pure-logic packages (no DOM environment).
 * Used by `packages/contracts` and `apps/worker`.
 */
export const baseConfig = defineConfig({
  test: {
    environment: 'node',
    include: ['**/*.test.ts'],
    exclude: ['node_modules', '.next', 'dist', 'coverage'],
  },
})
