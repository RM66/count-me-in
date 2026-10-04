'use client'

import type { UpdateOrganizerProfileInput } from '@repo/contracts'
import { organizerEnvelope } from '@repo/contracts'
import { AVATAR_UPLOAD_MAX_BYTES } from '@repo/contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { get, patch } from './client'
import { resizeAvatar, uploadImage } from './image'
import { queryKeys } from './keys'

/**
 * Client-side API for the **Organizer** entity: reads, profile writes and the
 * avatar upload flow. Queries and the mutations that invalidate them live
 * together on purpose — they share `queryKeys.organizer.me`.
 */

/**
 * Current organizer profile (cabinet). Identity comes from the Auth.js session
 * via `X-Organizer-Auth`; anonymous callers get the demo profile (ADR-010).
 */
export function useCurrentOrganizer() {
  return useQuery({
    queryKey: queryKeys.organizer.me,
    queryFn: () => get('/api/organizers/me', organizerEnvelope),
    select: (data) => data.organizer,
  })
}

/**
 * Whether the signed-in organizer is the read-only demo account (ADR-010).
 * Drives disabled inputs and the cabinet banner. Defaults to `false` while the
 * profile is loading — the API is the real gate.
 */
export function useIsDemo(): boolean {
  const { data: organizer } = useCurrentOrganizer()
  return organizer?.isDemo ?? false
}

/**
 * Updates the current organizer's profile.
 * Writes the response straight into the cache — the endpoint returns the
 * updated profile, so a refetch would be redundant.
 */
export function useUpdateOrganizerProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateOrganizerProfileInput) =>
      patch('/api/organizers/me', input, organizerEnvelope, 'application/merge-patch+json'),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.organizer.me, data)
    },
  })
}

/**
 * Upload an avatar for the current organizer.
 * Flow: downscale + re-encode in browser → request signed upload URL →
 * upload to R2 → update organizer profile → update query cache.
 */
export function useUploadAvatar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File) => {
      const photoUrl = await uploadImage({
        file,
        resize: resizeAvatar,
        maxBytes: AVATAR_UPLOAD_MAX_BYTES,
        endpoint: '/api/organizers/me/avatar',
      })

      return patch(
        '/api/organizers/me',
        { photoUrl },
        organizerEnvelope,
        'application/merge-patch+json',
      )
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.organizer.me, data)
    },
  })
}
