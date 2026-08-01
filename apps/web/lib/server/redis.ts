import Redis from 'ioredis'

import 'server-only'

/**
 * Redis singleton (OTP codes, tickets, rate limits — see ADR-005).
 * Cached on globalThis so Next.js dev HMR doesn't open a new connection per reload.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis }

export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    const url = process.env.REDIS_URL
    if (!url) {
      throw new Error('REDIS_URL is not set')
    }
    globalForRedis.redis = new Redis(url, { maxRetriesPerRequest: 2 })
  }
  return globalForRedis.redis
}
