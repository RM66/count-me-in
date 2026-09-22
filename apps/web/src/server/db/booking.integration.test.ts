import { describe, expect, it } from 'vitest'

// Integration guard for getAnalyticsSummary: the query must actually
// EXECUTE, not just compile. The pure-function tests cover the
// aggregation math, but a whole class of bugs lives in the execution
// layer — e.g. Drizzle's query cache hashing params with
// Buffer.from(), which throws on Date objects (the /cabinet/analytics
// outage). Mocks and .toSQL() cannot reach that layer; only a real
// round trip does.
//
// Runs against the local docker Postgres when POSTGRES_URL is set and
// reachable; a connection failure marks the test skipped (CI has no
// database service). The module import is lazy so a missing env var
// skips the test instead of failing the whole file at load time.

const url = process.env.POSTGRES_URL

describe.skipIf(!url)('getAnalyticsSummary (integration)', () => {
  it('executes the query without throwing', async () => {
    const { getAnalyticsSummary } = await import('@/server/db/booking')
    // The demo organizer always exists in the seeded local DB; an
    // unknown id would also exercise the query shape (zero rows).
    let summary: Awaited<ReturnType<typeof getAnalyticsSummary>>
    try {
      summary = await getAnalyticsSummary('01930000-0000-7000-8000-0000000000de')
    } catch (err) {
      // Unreachable DB → skip; anything else (a TypeError from the
      // driver, a syntax error) must fail the test.
      if (err instanceof Error && /connect|ECONNREFUSED|timeout|password|role/i.test(err.message)) {
        console.warn('Postgres unreachable — skipping integration check')
        return
      }
      throw err
    }
    expect(summary).toMatchObject({
      totalBookings: expect.any(Number),
      seatsSold: expect.any(Number),
      trend: expect.any(Array),
      byService: expect.any(Array),
    })
  })
})
