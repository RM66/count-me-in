import { describe, expect, it, vi } from 'vitest'

import { derivedInternalSecret } from '@/server/internal-api'

import 'server-only'

vi.mock('next/headers', () => ({ headers: vi.fn() }))

/**
 * Golden-vector parity for the internal service secret.
 *
 * The expected value is produced by the Python implementation
 * (`countmein/auth/internal.py::derived_internal_secret`); any drift in
 * salt, info string, or extract-expand order breaks Auth.js lookups with
 * a 401, so the vector — not a re-implementation — is the assertion.
 */

describe('derivedInternalSecret', () => {
  it('matches the Python golden vector', () => {
    expect(derivedInternalSecret('test-auth-secret')).toBe(
      '73b1b535eb4ded0b2f67951c5f9baf63b26be71360d8401d8a49d2a24c1dd106',
    )
  })

  it('is deterministic and secret-sensitive', () => {
    expect(derivedInternalSecret('test-auth-secret')).toBe(
      derivedInternalSecret('test-auth-secret'),
    )
    expect(derivedInternalSecret('other-secret')).not.toBe(
      derivedInternalSecret('test-auth-secret'),
    )
  })

  it('uses a purpose-bound info string, not the raw HMAC of the secret', async () => {
    const { createHmac } = await import('node:crypto')
    expect(derivedInternalSecret('same-secret')).not.toBe(
      createHmac('sha256', 'countmein').update('same-secret', 'utf8').digest('hex'),
    )
  })
})
