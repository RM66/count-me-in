import { z } from 'zod'

import { serviceId, uuid } from './primitives'

/**
 * Realtime slot-occupancy fan-out (ADR-025).
 *
 * Occupancy changes are pushed over Upstash Realtime (streams for
 * bounded replay + pub/sub for live delivery + an SSE route) as
 * invalidation signals. The Python API rides the target ids inside its
 * post-commit revalidation hop; `/api/internal/revalidate` emits via
 * `@upstash/realtime` onto the service and organizer channels, and
 * subscribed browsers refetch their query / server component.
 *
 * UI freshness is not an invariant: the conditional `UPDATE` alone
 * prevents overbooking.
 */

/** The single event name of this iteration — a nested path in the schema map both sides share. */
export const REALTIME_EVENT_SLOT_OCCUPANCY = 'slot.occupancy'

/** Channel prefixes: `service:*` is public; `organizer:*` is session-scoped by the SSE route. */
export const REALTIME_CHANNEL_SERVICE_PREFIX = 'service:'
export const REALTIME_CHANNEL_ORGANIZER_PREFIX = 'organizer:'

/** Channel names, shared by the emit path and the browser subscribers. */
export const realtimeChannels = {
  service: (id: string) => `${REALTIME_CHANNEL_SERVICE_PREFIX}${id}`,
  organizer: (id: string) => `${REALTIME_CHANNEL_ORGANIZER_PREFIX}${id}`,
} as const

/**
 * Stream retention applied on every emit: MAXLEN bounds replay history,
 * EXPIRE drops idle channel keys. A stale ack just means partial replay
 * — the periodic reconcile restores state; these only size the gap-free
 * reconnect window.
 */
export const REALTIME_HISTORY_MAX_LENGTH = 200
export const REALTIME_HISTORY_TTL_S = 86_400

/**
 * Minimal occupancy-change signal: identifies the affected service and
 * organizer channels for `/api/internal/revalidate` and the SSE stream.
 * Browsers treat receipt as an invalidation trigger and refetch over
 * HTTP — no slot counters or version numbers travel on the event.
 */
export const slotOccupancyEvent = z.object({
  serviceId,
  organizerId: uuid,
})
export type SlotOccupancyEvent = z.infer<typeof slotOccupancyEvent>
