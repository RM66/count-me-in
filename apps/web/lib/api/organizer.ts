'use client'

import type {
  AvatarUploadTarget,
  OrganizerProfile,
  UpdateOrganizerProfileInput,
} from '@repo/api-contracts'
import { AVATAR_UPLOAD_MAX_BYTES } from '@repo/api-contracts'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { get, post, put } from './client'
import { ApiError } from './error'
import { resizeAvatar } from './image'
import { queryKeys } from './keys'

/**
 * Client-side API for the **Organizer** entity: reads, profile writes and the
 * avatar upload flow.
 *
 * Queries and the mutations that invalidate them live together on purpose —
 * they share `queryKeys.organizer.me`, and splitting them across files is how
 * a cache write silently starts targeting the wrong key.
 */

/**
 * Current organizer profile (cabinet). Identity comes from the Auth.js session
 * cookie — the endpoint returns 401 when unauthenticated.
 */
export function useCurrentOrganizer() {
  return useQuery({
    queryKey: queryKeys.organizer.me,
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

/**
 * Updates the current organizer's profile.
 * Writes the response straight into the cache — the endpoint returns the
 * updated profile, so a refetch would be redundant.
 */
export function useUpdateOrganizerProfile() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateOrganizerProfileInput) =>
      put<{ organizer: OrganizerProfile }>('/api/organizers/me', input),
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.organizer.me, data)
    },
  })
}

/**
 * Upload an avatar for the current organizer.
 * Flow:
 * 1. Downscale + re-encode in the browser (512×512 WebP)
 * 2. Request signed upload URL from API
 * 3. Upload the resized blob directly to R2
 * 4. Update organizer profile with the public URL
 * 5. Update query cache
 */
export function useUploadAvatar() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (file: File) => {
      // Step 1: Resize before signing — the signed URL commits to an exact
      // Content-Type and Content-Length, so bytes must be final at this point.
      const image = await resizeAvatar(file)

      if (image.size > AVATAR_UPLOAD_MAX_BYTES) {
        throw new ApiError('Could not compress that image enough — try another one', 413)
      }

      // Step 2: Get signed upload URL. `image.type` is authoritative: a browser
      // without WebP encoding may have fallen back to another format.
      const target = await post<AvatarUploadTarget>('/api/organizers/me/avatar', {
        contentType: image.type,
        size: image.size,
      })

      // Step 3: Upload directly to R2
      const r2Response = await fetch(target.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': image.type },
        body: image,
      })

      if (!r2Response.ok) {
        throw new ApiError('Upload failed — try again', r2Response.status)
      }

      // Step 4: Update organizer profile with the public URL
      return put<{ organizer: OrganizerProfile }>('/api/organizers/me', {
        photoUrl: target.publicUrl,
      })
    },
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.organizer.me, data)
    },
  })
}
