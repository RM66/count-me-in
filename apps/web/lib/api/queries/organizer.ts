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
