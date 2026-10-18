/**
 * React Query key factory.
 * The single source of truth for cache keys. A query and the mutation that
 * invalidates it must agree on the key — writing the array literal in both
 * places is how caches silently stop invalidating. Import from here instead.
 *
 * Keys are hierarchical, so a prefix invalidates everything beneath it. If a
 * client-cached list ever appears, grow a group the same way —
 * `services: { all: ['services'], detail: (id) => ['services', id] }` —
 * so `queryKeys.services.all` drops the list and every detail beneath it.
 *
 * Only `organizer.me` and `publicService` are live today: cabinet lists
 * and details are server-component reads (`server/api-client.ts`,
 * `router.refresh()` after a write), while the organizer profile and
 * the public service view (live occupancy, ADR-025) are cached
 * client-side.
 */

export const queryKeys = {
  organizer: {
    me: ['organizer', 'me'] as const,
  },
  // The public service read — the key SSE invalidation and the
  // connect-reconcile refetch share.
  publicService: {
    all: ['public-service'] as const,
    detail: (id: string) => ['public-service', id] as const,
  },
} as const
