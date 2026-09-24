import { describe, expect, it } from 'vitest'

import { hashManageToken } from './manage-token'

// Parity vectors: the same SHA-256 hex must come out of the TS helper,
// the Go helper (pkg/db.HashManageToken — shared_test.go carries the
// same table) and the SQL lookup key. Pinned so a change on any one
// side fails this test. The cases cover the shapes a token can
// plausibly take: empty, short, unicode/emoji, and both ends of the
// length spectrum.
describe('hashManageToken', () => {
  it('matches the pinned SHA-256 parity vectors', () => {
    const vectors: ReadonlyArray<readonly [string, string]> = [
      [
        'countmein-parity-vector',
        'fdacba0aa4450ff1b8a7a6c94795723794dc2987dac5bb0b2f81f6cadfd9f7a4',
      ],
      ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      ['0123456789', '84d89877f0d4041efb6bf91a16f0248f2fd573e6af05c19f96bedb9f882f7882'],
      ['токен-🔑-парity', 'af5cd9735dddab01d8c050b125086b0e655cdbb63c2b462d4f7fa1090cb606c0'],
      ['A'.repeat(64), 'd53eda7a637c99cc7fb566d96e9fa109bf15c478410a3f5eb4d4c4e26cd081f6'],
      ['A'.repeat(256), 'e075f2f51cad23d0537186cfcd50f911ea954f9c2e32a437f45327f1b7899bbb'],
    ]
    for (const [token, want] of vectors) {
      expect(hashManageToken(token)).toBe(want)
    }
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
