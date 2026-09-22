import { describe, expect, it } from 'vitest'

import { hashManageToken } from './manage-token'

// Parity vector: the same SHA-256 hex must come out of the TS helper,
// the Go helper (pkg/db.HashManageToken) and the SQL lookup key. The
// expected value is sha256('countmein-parity-vector') — pinned so a
// change on any one side fails this test.
describe('hashManageToken', () => {
  it('matches the pinned SHA-256 parity vector', () => {
    expect(hashManageToken('countmein-parity-vector')).toBe(
      'fdacba0aa4450ff1b8a7a6c94795723794dc2987dac5bb0b2f81f6cadfd9f7a4',
    )
  })

  it('is deterministic and hex-encoded', () => {
    const a = hashManageToken('token-1')
    const b = hashManageToken('token-1')
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('differs per token', () => {
    expect(hashManageToken('token-1')).not.toBe(hashManageToken('token-2'))
  })
})
