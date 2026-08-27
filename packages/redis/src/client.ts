import Redis from 'ioredis'

/**
 * Shared Redis client.
 *
 * Redis is infrastructure shared across the web app's server layers — sessions,
 * auth tickets, rate limits, and minting one-time login links from notification
 * jobs — so the connection lives here for the same reason `@repo/db` owns the
 * Postgres pool. Two hand-rolled singletons drifted apart almost immediately,
 * which is exactly the failure a shared package prevents.
 *
 * What is *not* here: key names and payload shapes. Those are contracts between
 * the two apps and live in `@repo/contracts` (see `loginLinkKey`).
 *
 * Note this package cannot carry `import 'server-only'` — the worker is not a
 * Next app and that module would throw there.
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
