import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// reportContractViolation branches on NODE_ENV at call time: throws in test,
// logs in development, reports to Sentry in production. The test-env throw is
// already pinned through client.test.ts; this file pins the other two.

const mockCaptureMessage = vi.fn()
vi.mock('@sentry/nextjs', () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
}))

import { reportContractViolation, schemaIdOf } from './contract'

function zodError(): z.ZodError {
  const parsed = z.object({ id: z.string() }).safeParse({ id: 1 })
  if (parsed.success) throw new Error('expected the fixture to fail parsing')
  return parsed.error
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('reportContractViolation', () => {
  it('throws with the issue detail under NODE_ENV=test', () => {
    expect(() => reportContractViolation('/api/x', 'TestSchema', zodError())).toThrow(
      /api contract violation at \/api\/x \(TestSchema\): id:/,
    )
  })

  it('logs and returns under NODE_ENV=development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    reportContractViolation('/api/x', 'TestSchema', zodError())

    expect(spy).toHaveBeenCalledWith(expect.stringContaining('api contract violation'))
    expect(mockCaptureMessage).not.toHaveBeenCalled()
  })

  it('reports to Sentry under NODE_ENV=production', () => {
    vi.stubEnv('NODE_ENV', 'production')

    reportContractViolation('/api/x', 'TestSchema', zodError())

    expect(mockCaptureMessage).toHaveBeenCalledWith(
      'api contract violation',
      expect.objectContaining({ level: 'warning' }),
    )
  })
})

describe('schemaIdOf', () => {
  it("falls back to 'unknown' for a schema with no registered id", () => {
    expect(schemaIdOf(z.object({ id: z.string() }))).toBe('unknown')
  })
})
