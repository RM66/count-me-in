import {
  REALTIME_HISTORY_MAX_LENGTH,
  REALTIME_HISTORY_TTL_S,
  slotOccupancyEvent,
} from '@repo/contracts'
import { Realtime } from '@upstash/realtime'
import { Redis } from '@upstash/redis'

import { realtimeRestConfig } from './realtime-config'

import 'server-only'

/**
 * The Upstash Realtime instance backing `/api/realtime` (ADR-025) —
 * `/api/internal/revalidate` emits through it too.
 *
 * `maxDurationSecs` must equal the route segment's `maxDuration`: the
 * handler closes the stream ~2s early so the client reconnects on a
 * fresh function. The route spells its segment config as a literal (an
 * imported constant breaks the production build) — this is the same
 * number, pinned by `route.test.ts`.
 */
export const REALTIME_MAX_DURATION_S = 300

// Unresolved config stays side-effect-free: dev without realtime creds
// still loads the module. The browser learns "realtime is on" via the
// `realtimeEnabled` flag from the root layout, never these values.
const restConfig = realtimeRestConfig()

/** REST pair resolved? The internal route consults this so `emitted`
 * is honest — the SDK only warns, never throws, when unconfigured. */
export const realtimeConfigured = restConfig !== null

export const realtime = new Realtime({
  // undefined, not a throw, when unresolved — the subscribe handler
  // then 500s, a path the client never takes when realtime is off.
  // retry: false — ADR-025 specifies no application-side retry, and
  // @upstash/redis's default 5 retries (~11.5s backoff) would exceed
  // the Python caller's 2s hop timeout.
  redis: restConfig
    ? new Redis({ url: restConfig.url, token: restConfig.token, retry: false })
    : undefined,
  maxDurationSecs: REALTIME_MAX_DURATION_S,
  schema: {
    slot: {
      occupancy: slotOccupancyEvent,
    },
  },
  history: {
    maxLength: REALTIME_HISTORY_MAX_LENGTH,
    expireAfterSecs: REALTIME_HISTORY_TTL_S,
  },
})
