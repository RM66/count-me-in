/**
 * Server-side service cover upload orchestration.
 *
 * Mirrors `avatar.ts`: the browser resizes and re-encodes, asks for a signed
 * PUT, uploads straight to R2, and only then sends the resulting public URL to
 * the services API (ADR-007).
 */
import type { CreateServicePhotoUploadInput, ImageUploadTarget } from '@repo/api-contracts'
import { createSignedUploadUrl, publicUrl, servicePhotoKey } from '@repo/storage'

import 'server-only'

/** Map an accepted content type to the extension stored in R2. */
const EXT_BY_CONTENT_TYPE: Record<string, 'jpg' | 'png' | 'webp'> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/**
 * Create a signed upload URL for a service cover photo.
 *
 * Keyed by **organizer**, not by service: covers are uploaded from the "new
 * service" form before the service row exists (see `servicePhotoKey`).
 */
export async function createServicePhotoUpload(
  organizerId: string,
  input: CreateServicePhotoUploadInput,
): Promise<ImageUploadTarget> {
  const ext = EXT_BY_CONTENT_TYPE[input.contentType]
  if (!ext) {
    throw new Error(`Unsupported content type: ${input.contentType}`)
  }

  const key = servicePhotoKey(organizerId, ext)

  const { uploadUrl, expiresAt } = await createSignedUploadUrl({
    key,
    contentType: input.contentType,
    contentLength: input.size,
  })

  return {
    uploadUrl,
    publicUrl: publicUrl(key),
    expiresAt,
  }
}
