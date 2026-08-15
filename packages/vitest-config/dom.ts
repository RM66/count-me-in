import { mergeConfig } from 'vitest/config'

import { baseConfig } from './base'

/**
 * DOM-enabled Vitest config for React component and hook tests.
 * Used by `apps/web` — adds happy-dom and `.test.tsx` glob + setup file.
 */
export const domConfig = mergeConfig(baseConfig, {
  test: {
    environment: 'happy-dom',
    include: ['**/*.test.ts', '**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
  },
})
