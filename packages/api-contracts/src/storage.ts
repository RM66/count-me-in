import { z } from 'zod'

/**
 * Max size of the *source* file the organizer may pick in the file dialog.
 * The browser downscales before upload (see `apps/web/lib/helpers/image.ts`),
 * so this only guards against decoding absurdly large files in the tab.
 */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024

/**
 * Max size of the *resized* payload accepted by the API / signed PUT.
 * A 512×512 WebP at quality 0.85 lands around 30–60 KB, so 1 MB is a generous
 * ceiling that still keeps a mistyped or un-resized request out of the bucket.
 */
export const AVATAR_UPLOAD_MAX_BYTES = 1024 * 1024

/** Longest edge of the stored avatar, in pixels. Square, center-cropped. */
export const AVATAR_TARGET_SIZE = 512

/** WebP quality used when re-encoding in the browser. */
export const AVATAR_WEBP_QUALITY = 0.85

/** Image types the organizer may pick in the file dialog. */
export const avatarContentType = z.enum(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Type actually stored in R2 — the browser always re-encodes to WebP.
 * Kept separate from `avatarContentType` (what may be picked) on purpose.
 */
export const AVATAR_OUTPUT_CONTENT_TYPE = 'image/webp' as const

export const createAvatarUploadInput = z.object({
  contentType: avatarContentType,
  size: z.number().int().positive().max(AVATAR_UPLOAD_MAX_BYTES),
})
export type CreateAvatarUploadInput = z.infer<typeof createAvatarUploadInput>

export const avatarUploadTarget = z.object({
  uploadUrl: z.url(),
  publicUrl: z.url(),
  expiresAt: z.string(), // ISO
})
export type AvatarUploadTarget = z.infer<typeof avatarUploadTarget>
