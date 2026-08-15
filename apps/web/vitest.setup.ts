import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

import '@testing-library/jest-dom/vitest'

// Unmount React trees after each test to prevent memory leaks and
// cross-test state bleed.
afterEach(() => {
  cleanup()
})
