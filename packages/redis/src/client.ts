/**
 * Shared Redis client.
 *
 * Redis is infrastructure both apps talk to — `apps/web` for sessions, auth
 * tickets and rate limits, `apps/worker` for minting one-time login links — so
 * the connection lives here for the same reason `@repo/db` owns the Postgres
 * pool. Two hand-rolled singletons drifted apart almost immediately (one read
 * `REDIS_URL` itself, the other took a url argument), which is exactly the
 * failure a shared package prevents.
 *
 * What is *not* here: key names and payload shapes. Those are contracts between
 * the two apps and live in `@repo/api-contracts` (see `loginLinkKey`).
 *
 * Note this package cannot carry `import 'server-only'` — the worker is not a
 * Next app and that module would throw there. `@repo/db` has the same property;
 * both are server infrastructure that no client bundle should reach for.
 */

import Redis from 'ioredis'

/**
 * Cached on `globalThis` rather than a module-level `let`.
 *
 * Next's dev HMR re-evaluates modules on every edit; a module-scoped variable
 * would open a fresh connection each time until the server runs out. Harmless
 * in the worker, which loads the module once.
 */
const globalForRedis = globalThis as unknown as { redis?: Redis }

/**
 * The shared connection, opened on first use.
 *
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

    // ioredis is an EventEmitter: an emitted `error` with no listener is an
    // unhandled exception that takes the whole process down. A dropped
    // connection must not kill a worker that is mid-job.
    client.on('error', (error) => {
      console.error('[redis] connection error:', error)
    })

    globalForRedis.redis = client
  }

  return globalForRedis.redis
}

/**
 * Close the connection.
 *
 * For long-running processes that shut down deliberately — the worker drains
 * its jobs on `SIGTERM` and would otherwise hang on an open socket. The Next
 * server has no such lifecycle and never calls this, exactly as it never calls
 * `client.end()` from `@repo/db`.
 */
export async function closeRedis(): Promise<void> {
  if (globalForRedis.redis) {
    await globalForRedis.redis.quit()
    globalForRedis.redis = undefined
  }
}
