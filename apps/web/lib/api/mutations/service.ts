'use client'

import type {
  CreateServiceInput,
  ImageUploadTarget,
  ServiceRecord,
  UpdateServiceInput,
} from '@repo/api-contracts'
import { SERVICE_PHOTO_UPLOAD_MAX_BYTES } from '@repo/api-contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { resizeServicePhoto } from '@/lib/helpers/image'
import { del, post, put } from '../client'
import { ApiError } from '../error'

/** Drop every cached service list/detail so the next read refetches. */
function invalidateServices(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: ['services'] })
}

/** Create a service owned by the signed-in organizer. */
export function useCreateService() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CreateServiceInput) =>
      post<{ service: ServiceRecord }>('/api/services', input),
    onSuccess: () => invalidateServices(queryClient),
  })
}

/** Update one service. Only the fields present in `input` are written. */
export function useUpdateService(serviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: UpdateServiceInput) =>
      put<{ service: ServiceRecord }>(`/api/services/${serviceId}`, input),
    onSuccess: () => invalidateServices(queryClient),
  })
}

/** Delete one service. Slots and bookings cascade server-side. */
export function useDeleteService(serviceId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => del<{ id: string }>(`/api/services/${serviceId}`),
    onSuccess: () => invalidateServices(queryClient),
  })
}

/**
 * Upload a service cover and resolve to its public URL.
 *
 * Unlike {@link useUploadAvatar} this deliberately **does not persist** the URL:
 * the "new service" form has no row to attach it to yet, so the caller keeps the
 * returned URL in form state and it is saved with the rest of the fields. That
 * also makes "pick a photo, then cancel" a no-op on the database.
 *
 * Flow: resize in-browser → signed URL → PUT to R2 → return the public URL.
 */
export function useUploadServicePhoto() {
  return useMutation({
    mutationFn: async (file: File): Promise<string> => {
      // Resize before signing — the signed URL commits to an exact
      // Content-Type and Content-Length, so bytes must be final at this point.
      const image = await resizeServicePhoto(file)

      if (image.size > SERVICE_PHOTO_UPLOAD_MAX_BYTES) {
        throw new ApiError('Could not compress that image enough — try another one', 413)
      }

      // `image.type` is authoritative: a browser without WebP encoding may have
      // fallen back to another format.
      const target = await post<ImageUploadTarget>('/api/organizers/me/service-photo', {
        contentType: image.type,
        size: image.size,
      })

      const r2Response = await fetch(target.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': image.type },
        body: image,
      })

      if (!r2Response.ok) {
        throw new ApiError('Upload failed — try again', r2Response.status)
      }

      return target.publicUrl
    },
  })
}
