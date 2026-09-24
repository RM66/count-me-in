import { afterAll, describe, expect, it } from 'vitest'

/**
 * Redis-backed tests for the auth ticket and login-link halves (ADR-008).
 *
 * Single-use semantics are the whole point of both tokens: a replayed consume
 * must return null. `getdel` is what enforces it, and only a real Redis
 * exercises that — a mock would just re-implement the code under test.
 *
 * Gating: skip locally without REDIS_URL, fail in CI (service guaranteed).
 */

const hasRedis = Boolean(process.env.REDIS_URL)
const maybeDescribe = !hasRedis && process.env.CI !== 'true' ? describe.skip : describe

maybeDescribe('auth tickets and login links (integration, real Redis)', () => {
  // Tokens minted below are random (`auth:ticket:<random>`), so the
  // cleanup tracks exactly what this run created — a fixed key pattern
  // would match nothing and leave the keys to their TTL.
  const mintedTickets: string[] = []

  afterAll(async () => {
    if (!hasRedis || mintedTickets.length === 0) return
    const { getRedis } = await import('@repo/redis')
    const redis = getRedis()
    await redis.del(...mintedTickets.map((token) => `auth:ticket:${token}`))
  })

  describe('issueTicket / consumeTicket', () => {
    it('round-trips the payload and is single-use', async () => {
      const { issueTicket, consumeTicket, TICKET_BASE64URL_LENGTH } =
        await import('@/server/auth/ticket')
      const token = await issueTicket({
        messenger: 'telegram',
        messengerId: '12345',
        displayName: 'Test Guest',
        purpose: 'guest',
      })
      mintedTickets.push(token)
      expect(token).toHaveLength(TICKET_BASE64URL_LENGTH)

      const first = await consumeTicket(token)
      expect(first).toMatchObject({
        messenger: 'telegram',
        messengerId: '12345',
        displayName: 'Test Guest',
        purpose: 'guest',
      })
      // Single-use: the replay gets null.
      expect(await consumeTicket(token)).toBeNull()
    })

    it('returns null for an unknown token', async () => {
      const { consumeTicket } = await import('@/server/auth/ticket')
      expect(await consumeTicket('no-such-ticket-token')).toBeNull()
    })

    it('keeps organizer and guest purposes distinct in the payload', async () => {
      const { issueTicket, consumeTicket } = await import('@/server/auth/ticket')
      const organizerToken = await issueTicket({
        messenger: 'telegram',
        messengerId: 'o-1',
        displayName: 'Org',
        purpose: 'organizer',
      })
      mintedTickets.push(organizerToken)
      const payload = await consumeTicket(organizerToken)
      expect(payload?.purpose).toBe('organizer')
    })
  })

  describe('peekLoginLink / consumeLoginLink', () => {
    it('peek does not consume — consume is single-use', async () => {
      const { loginLinkKey } = await import('@repo/contracts')
      const { peekLoginLink, consumeLoginLink } = await import('@/server/auth/login-link')
      const { getRedis } = await import('@repo/redis')

      // Mint a link the way the Go API does: { organizerId, next } under the
      // shared key format.
      const token = 'test-login-link-token-1'
      const payload = { organizerId: '01930000-0000-7000-8000-0000000000de', next: '/cabinet' }
      await getRedis().set(loginLinkKey(token), JSON.stringify(payload), 'EX', 60)

      // Peek twice — the token survives both (preview crawlers fetch GETs).
      expect(await peekLoginLink(token)).toEqual(payload)
      expect(await peekLoginLink(token)).toEqual(payload)

      // Consume once — the winner gets the payload.
      expect(await consumeLoginLink(token)).toEqual(payload)
      // Replay: null.
      expect(await consumeLoginLink(token)).toBeNull()
      expect(await peekLoginLink(token)).toBeNull()
    })

    it('returns null for garbage stored under the key', async () => {
      const { loginLinkKey } = await import('@repo/contracts')
      const { peekLoginLink, consumeLoginLink } = await import('@/server/auth/login-link')
      const { getRedis } = await import('@repo/redis')

      const token = 'test-login-link-token-garbage'
      await getRedis().set(loginLinkKey(token), 'not-json{', 'EX', 60)
      expect(await peekLoginLink(token)).toBeNull()
      expect(await consumeLoginLink(token)).toBeNull()

      // Schema-invalid JSON parses but fails the payload schema → null.
      await getRedis().set(loginLinkKey(token), JSON.stringify({ wrong: 'shape' }), 'EX', 60)
      expect(await peekLoginLink(token)).toBeNull()
    })

    it('returns null for an unknown token', async () => {
      const { peekLoginLink, consumeLoginLink } = await import('@/server/auth/login-link')
      expect(await peekLoginLink('no-such-link-token')).toBeNull()
      expect(await consumeLoginLink('no-such-link-token')).toBeNull()
    })
  })
})
