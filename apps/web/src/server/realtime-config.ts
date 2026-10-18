import 'server-only'

/**
 * Resolves the realtime REST endpoint + token (ADR-025) for the SSE
 * handler and the internal emit. Sources, in order:
 *
 * 1. `REDIS_REST_URL` — `http(s)://[:user]:token@host[:port]`, e.g. the
 *    compose up-redis emulator or a self-hosted proxy.
 * 2. `REDIS_URL` — an Upstash TCP URL carries the same credential:
 *    `redis(s)://…:token@*.upstash.io` → `https://host` + password.
 *
 * `null` = realtime off: emit skips, browser never subscribes. A
 * malformed `REDIS_REST_URL` resolves to null too — "off" outside
 * production, a cold-start refusal via `config.validate` in production.
 * `realtime_credentials()` in the Python API mirrors this for
 * `config.validate()` — keep the two in sync.
 */
export function realtimeRestConfig(): { url: string; token: string } | null {
  const explicit = process.env.REDIS_REST_URL?.trim()
  if (explicit) {
    try {
      const parsed = new URL(explicit)
      const token = decodeURIComponent(parsed.password || parsed.username)
      if (
        (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
        parsed.hostname !== '' &&
        token !== ''
      ) {
        return { url: parsed.origin, token }
      }
    } catch {
      // fall through — treated as unconfigured
    }
    return null
  }
  const redisUrl = process.env.REDIS_URL?.trim()
  if (redisUrl) {
    try {
      const parsed = new URL(redisUrl)
      if (
        (parsed.protocol === 'redis:' || parsed.protocol === 'rediss:') &&
        parsed.hostname.endsWith('.upstash.io') &&
        parsed.password !== ''
      ) {
        return { url: `https://${parsed.hostname}`, token: decodeURIComponent(parsed.password) }
      }
    } catch {
      // fall through — treated as unconfigured
    }
  }
  return null
}
