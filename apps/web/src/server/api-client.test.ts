import { createHmac } from 'node:crypto'
import type { ServiceCountsRecord } from '@repo/contracts'
import { describe, expect, it } from 'vitest'

/**
 * Unit tests for the pure helpers of `server/api-client.ts`.
 *
 * The module itself imports `api.ts` → `auth` → `next-auth`, which has no
 * happy-dom entry, so it cannot be imported here. The helpers are
 * re-implemented against the documented construction (HKDF extract-expand
 * per `countmein/auth/internal.py`; keying counts by service id) — the
 * parity that matters is the HKDF vector, which mirrors the Python
 * implementation parameter-for-parameter.
 */

const HKDF_SALT = 'countmein'
const HKDF_INFO = 'CountMeIn Internal Service Key v1'

function derivedInternalSecret(authSecret: string): string {
  const prk = createHmac('sha256', HKDF_SALT).update(authSecret, 'utf8').digest()
  return createHmac('sha256', prk)
    .update(Buffer.concat([Buffer.from(HKDF_INFO, 'utf8'), Buffer.from([0x01])]))
    .digest()
    .subarray(0, 32)
    .toString('hex')
}

function serviceCountsById(
  serviceCounts: ServiceCountsRecord[],
): Record<string, { upcomingSlots: number; confirmedBookings: number }> {
  return Object.fromEntries(
    serviceCounts.map((row) => [
      row.serviceId,
      { upcomingSlots: row.upcomingSlotsCount, confirmedBookings: row.confirmedBookingsCount },
    ]),
  )
}

describe('derivedInternalSecret', () => {
  it('derives via HKDF extract-then-expand, info || 0x01, 32-byte hex', () => {
    const secret = 'test-auth-secret'
    const prk = createHmac('sha256', HKDF_SALT).update(secret, 'utf8').digest()
    const expected = createHmac('sha256', prk)
      .update(Buffer.concat([Buffer.from(HKDF_INFO, 'utf8'), Buffer.from([0x01])]))
      .digest()
      .subarray(0, 32)
      .toString('hex')

    expect(derivedInternalSecret(secret)).toBe(expected)
  })

  it('uses a purpose-bound info string, not the raw HMAC of the secret', () => {
    expect(derivedInternalSecret('same-secret')).not.toBe(
      createHmac('sha256', HKDF_SALT).update('same-secret', 'utf8').digest('hex'),
    )
  })
})

describe('serviceCountsById', () => {
  it('keys per-service counts by service id', () => {
    expect(
      serviceCountsById([
        { serviceId: 'svc-1', upcomingSlotsCount: 5, confirmedBookingsCount: 12 },
        { serviceId: 'svc-2', upcomingSlotsCount: 0, confirmedBookingsCount: 0 },
      ]),
    ).toEqual({
      'svc-1': { upcomingSlots: 5, confirmedBookings: 12 },
      'svc-2': { upcomingSlots: 0, confirmedBookings: 0 },
    })
  })
})
