/**
 * React Query key factory.
 *
 * The single source of truth for cache keys. A query and the mutation that
 * invalidates it live in the same entity file, but they still have to agree on
 * the key — writing the array literal in both places is how caches silently
 * stop invalidating. Import from here instead.
 *
 * Keys are hierarchical, so a prefix invalidates everything beneath it:
 * `invalidateQueries({ queryKey: queryKeys.services.all })` drops both the list
 * and every individual service detail.
 */

export const queryKeys = {
  organizer: {
    /** Current organizer profile, resolved from the session cookie. */
    me: ['organizer', 'me'] as const,
  },
  services: {
    /** Prefix for every service query — use to invalidate the whole entity. */
    all: ['services'] as const,
    /** One service by id. */
    detail: (id: string) => ['services', id] as const,
  },
  slots: {
    /** Prefix for every slot query — use to invalidate the whole entity. */
    all: ['slots'] as const,
    /** One slot by id. */
    detail: (id: string) => ['slots', id] as const,
  },
  bookings: {
    /** Prefix for every booking query — use to invalidate the whole entity. */
    all: ['bookings'] as const,
    /**
     * A guest's own bookings, keyed by the messenger identity they looked up
     * with — not by the one-shot ticket, which differs on every tap and would
     * make each lookup a permanent cache miss.
     */
    guest: (messengerId: string) => ['bookings', 'guest', messengerId] as const,
  },
} as const
