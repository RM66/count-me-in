import { defineConfig } from 'vitest/config'

/**
 * Vitest config for `packages/api-contracts` — pure logic, no DOM.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['node_modules', 'dist'],
  },
})
