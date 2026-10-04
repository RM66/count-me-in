import Redis from 'ioredis'

import 'server-only'

/**
 * The web app's Redis connection.
 *
 * Redis backs the server-side auth machinery — guest identity tickets,
 * one-time login links, rate limits — so the connection lives beside the
 * code that uses it, in `src/server/`. The Python API owns its own client
 * (`countmein/redis.py`); the key names and payload shapes shared across
 * the two runtimes are contracts and live in `@repo/contracts`
 * (see `loginLinkKey`), not here.
 */

const globalForRedis = globalThis as unknown as { redis?: Redis }

/**
 * The shared connection, opened on first use.
 * Lazy so that importing a module which *might* touch Redis does not open a
 * socket, and so a missing `REDIS_URL` surfaces at the call site rather than at
 * import time.
 */
export function getRedis(): Redis {
  if (!globalForRedis.redis) {
    const url = process.env.REDIS_URL
    if (!url) {
      throw new Error('REDIS_URL is not set')
    }

    const client = new Redis(url, { maxRetriesPerRequest: 2 })

    client.on('error', (error) => {
      console.error('[redis] connection error:', error)
    })

    globalForRedis.redis = client
  }

  return globalForRedis.redis
}
