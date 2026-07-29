'use client'

import type { OrganizerProfile, UpdateOrganizerProfileInput } from '@repo/api-contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { put } from '../client'

/**
 * Updates the current organizer's profile.
 * Invalidates the organizer query cache on success.
 */
export function useUpdateOrganizerProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateOrganizerProfileInput) =>
      put<{ organizer: OrganizerProfile }>('/api/organizers/me', input),
    onSuccess: (data) => {
      // Update the cache with the new profile data
      queryClient.setQueryData(['organizer', 'me'], data)
    },
  })
}
