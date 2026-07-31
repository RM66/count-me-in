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

/* -------------------------------------------------------------------------- */
/*                             Service cover photos                           */
/* -------------------------------------------------------------------------- */

/**
 * Service covers are **landscape**, not square like avatars, so they get their
 * own limits instead of reusing the avatar constants — a 16:9 cover rendered at
 * card width needs more horizontal pixels than a 512px avatar.
 */
export const SERVICE_PHOTO_MAX_BYTES = 10 * 1024 * 1024

/** Max size of the *resized* cover accepted by the API / signed PUT. */
export const SERVICE_PHOTO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024

/** Longest edge of the stored cover, in pixels. Aspect ratio is preserved. */
export const SERVICE_PHOTO_TARGET_SIZE = 1280

/** WebP quality used when re-encoding a cover in the browser. */
export const SERVICE_PHOTO_WEBP_QUALITY = 0.82

/** Image types the organizer may pick for a service cover. */
export const servicePhotoContentType = avatarContentType

/** Type actually stored in R2 — the browser always re-encodes to WebP. */
export const SERVICE_PHOTO_OUTPUT_CONTENT_TYPE = 'image/webp' as const

export const createServicePhotoUploadInput = z.object({
  contentType: servicePhotoContentType,
  size: z.number().int().positive().max(SERVICE_PHOTO_UPLOAD_MAX_BYTES),
})
export type CreateServicePhotoUploadInput = z.infer<typeof createServicePhotoUploadInput>

/**
 * Shape returned by any signed-upload endpoint. Identical to
 * {@link avatarUploadTarget} — aliased rather than duplicated so a future change
 * to the handshake lands in one place.
 */
export const imageUploadTarget = avatarUploadTarget
export type ImageUploadTarget = z.infer<typeof imageUploadTarget>
