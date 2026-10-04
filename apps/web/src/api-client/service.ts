'use client'

import type { CreateServiceInput, UpdateServiceInput } from '@repo/contracts'
import { deletedServiceEnvelope, serviceEnvelope } from '@repo/contracts'
import { SERVICE_PHOTO_UPLOAD_MAX_BYTES } from '@repo/contracts'
import { useMutation } from '@tanstack/react-query'

import { del, patch, post } from './client'
import { resizeServicePhoto, uploadImage } from './image'

/**
 * Client-side API for the **Service** entity — writes plus the cover upload
 * flow. Cabinet pages read services on the server (`server/api-client.ts`),
 * so there is no list/detail query here. The mutations return the created or
 * updated record; the caller follows with `router.refresh()` to re-render the
 * server component — there is no client cache to invalidate.
 */

/** Create a service owned by the signed-in organizer. */
export function useCreateService() {
  return useMutation({
    mutationFn: (input: CreateServiceInput) => post('/api/services', input, serviceEnvelope),
  })
}

/** Update one service. Only the fields present in `input` are written. */
export function useUpdateService() {
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateServiceInput }) =>
      patch(`/api/services/${id}`, input, serviceEnvelope, 'application/merge-patch+json'),
  })
}

/** Delete one service. Slots cascade server-side; a service whose
 * sessions were ever booked answers 409 and is not deleted. */
export function useDeleteService() {
  return useMutation({
    mutationFn: (id: string) => del(`/api/services/${id}`, deletedServiceEnvelope),
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
    mutationFn: (file: File): Promise<string> =>
      uploadImage({
        file,
        resize: resizeServicePhoto,
        maxBytes: SERVICE_PHOTO_UPLOAD_MAX_BYTES,
        endpoint: '/api/organizers/me/service-photo',
      }),
  })
}
