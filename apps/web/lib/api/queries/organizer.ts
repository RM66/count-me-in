'use client'

import type { OrganizerProfile } from '@repo/api-contracts'
import { useQuery } from '@tanstack/react-query'

import { get } from '../client'

/**
 * Current organizer profile (cabinet). Identity comes from the Auth.js session
 * cookie — the endpoint returns 401 when unauthenticated.
 */
export function useCurrentOrganizer() {
  return useQuery({
    queryKey: ['organizer', 'me'],
    queryFn: () => get<{ organizer: OrganizerProfile }>('/api/organizers/me'),
    select: (data) => data.organizer,
  })
}

/**
 * Whether the signed-in organizer is the read-only demo account (ADR-010).
 *
 * Drives disabled inputs and the cabinet banner. Defaults to `false` while the
 * profile is loading — the API is the real gate, so an optimistic `false` here
 * only ever means a control is briefly enabled before a rejected write.
 */
export function useIsDemo(): boolean {
  const { data: organizer } = useCurrentOrganizer()
  return organizer?.isDemo ?? false
}
