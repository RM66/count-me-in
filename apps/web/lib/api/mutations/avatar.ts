'use client'

import type { AvatarUploadTarget, OrganizerProfile } from '@repo/api-contracts'
import { AVATAR_UPLOAD_MAX_BYTES } from '@repo/api-contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { resizeAvatar } from '@/lib/helpers/image'
import { post, put } from '../client'
import { ApiError } from '../error'

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
      // Update the cache with the new profile data
      queryClient.setQueryData(['organizer', 'me'], data)
    },
  })
}
