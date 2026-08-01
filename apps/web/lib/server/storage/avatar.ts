/**
 * Server-side avatar upload orchestration.
 * See docs/plans/avatar-upload-r2.md
 */
import type { AvatarUploadTarget, CreateAvatarUploadInput } from '@repo/api-contracts'
import { avatarKey, createSignedUploadUrl, publicUrl } from '@repo/storage'

import 'server-only'

/**
 * Create a signed upload URL for an organizer's avatar.
 * Returns the upload URL (direct to R2), the resulting public URL, and expiration.
 */
export async function createAvatarUpload(
  organizerId: string,
  input: CreateAvatarUploadInput,
): Promise<AvatarUploadTarget> {
  // Map contentType to file extension
  const extMap: Record<string, 'jpg' | 'png' | 'webp'> = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }
  const ext = extMap[input.contentType]
  if (!ext) {
    throw new Error(`Unsupported content type: ${input.contentType}`)
  }

  // Generate versioned key
  const key = avatarKey(organizerId, ext)

  // Create signed upload URL
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
