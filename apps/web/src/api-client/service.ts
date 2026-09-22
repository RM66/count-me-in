'use client'

import type { CreateServiceInput, UpdateServiceInput } from '@repo/contracts'
import { deletedServiceEnvelope, imageUploadTarget, serviceEnvelope } from '@repo/contracts'
import { SERVICE_PHOTO_UPLOAD_MAX_BYTES } from '@repo/contracts'
import { useMutation } from '@tanstack/react-query'

import { del, post, put } from './client'
import { ApiError } from './error'
import { resizeServicePhoto } from './image'

/**
 * Last-resort fallbacks for upload failures: api-client has no locale, so the
 * display site (use-image-upload) translates by status. Named constants rather
 * than inline literals — intentional, documented fallback, not stray copy.
 */
const COMPRESS_ERROR_FALLBACK = 'Could not compress that image enough — try another one'
const UPLOAD_ERROR_FALLBACK = 'Upload failed — try again'

/**
 * Client-side API for the **Service** entity — writes plus the cover upload
 * flow. Cabinet pages read services on the server (`lib/server/db/service.ts`),
 * so there is no list/detail query here. The mutations return the created or
 * updated record; the caller follows with `router.refresh()` to re-render the
 * server component (Phase 2.3 — no client cache to invalidate).
 */

/** Create a service owned by the signed-in organizer. */
export function useCreateService() {
  return useMutation({
    mutationFn: (input: CreateServiceInput) => post('/api/services', input, serviceEnvelope),
  })
}

/** Update one service. Only the fields present in `input` are written. */
export function useUpdateService(serviceId: string) {
  return useMutation({
    mutationFn: (input: UpdateServiceInput) =>
      put(`/api/services/${serviceId}`, input, serviceEnvelope, 'application/merge-patch+json'),
  })
}

/** Delete one service. Slots and bookings cascade server-side. */
export function useDeleteService(serviceId: string) {
  return useMutation({
    mutationFn: () => del(`/api/services/${serviceId}`, deletedServiceEnvelope),
  })
}

/**
 * Upload a service cover and resolve to its public URL.
 * Unlike {@link useUploadAvatar} this deliberately **does not persist** the
 * URL: the "new service" form has no row to attach it to yet, so the caller
 * keeps the returned URL in form state and it is saved with the rest of the
 * fields. That also makes "pick a photo, then cancel" a no-op on the database.
 *
 * Flow: resize in-browser → signed URL → PUT to R2 → return the public URL.
 */
export function useUploadServicePhoto() {
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      const image = await resizeServicePhoto(file)

      if (image.size > SERVICE_PHOTO_UPLOAD_MAX_BYTES) {
        throw new ApiError(COMPRESS_ERROR_FALLBACK, 413)
      }

      const target = await post(
        '/api/organizers/me/service-photo',
        {
          contentType: image.type,
          size: image.size,
        },
        imageUploadTarget,
      )

      const r2Response = await fetch(target.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': image.type },
        body: image,
      })

      if (!r2Response.ok) {
        throw new ApiError(UPLOAD_ERROR_FALLBACK, r2Response.status)
      }

      return target.publicUrl
    },
  })
}
