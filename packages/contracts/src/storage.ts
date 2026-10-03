import { z } from 'zod'

/**
 * Image types the organizer may pick in the file dialog — shared by the
 * avatar and the service-cover pickers.
 */
export const imageContentType = z.enum(['image/jpeg', 'image/png', 'image/webp'])

/**
 * Type actually stored in R2 — the browser always re-encodes to WebP.
 * Kept separate from `imageContentType` (what may be picked) on purpose.
 */
export const IMAGE_OUTPUT_CONTENT_TYPE = 'image/webp' as const

/**
 * Shape returned by any signed-upload endpoint — one handshake shared by
 * the avatar and service-cover targets.
 */
export const imageUploadTarget = z.object({
  uploadUrl: z.url(),
  publicUrl: z.url(),
  expiresAt: z.string(), // ISO
})
export type ImageUploadTarget = z.infer<typeof imageUploadTarget>

/* -------------------------------------------------------------------------- */
/*                                  Avatars                                   */
/* -------------------------------------------------------------------------- */

/**
 * Max size of the *source* file the organizer may pick in the file dialog.
 * The browser downscales before upload, so this only guards against decoding
 * absurdly large files in the tab.
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

/** Resized avatar payload size accepted by the API / signed PUT. */
export const avatarUploadSize = z.number().int().min(1).max(AVATAR_UPLOAD_MAX_BYTES)

export const createAvatarUploadInput = z.object({
  contentType: imageContentType,
  size: avatarUploadSize,
})
export type CreateAvatarUploadInput = z.infer<typeof createAvatarUploadInput>

/* -------------------------------------------------------------------------- */
/*                             Service cover photos                           */
/* -------------------------------------------------------------------------- */

/**
 * Service covers are **landscape**, not square like avatars, so they get their
 * own limits instead of reusing the avatar constants — a 16:9 cover rendered
 * at card width needs more horizontal pixels than a 512px avatar.
 */
export const SERVICE_PHOTO_MAX_BYTES = 10 * 1024 * 1024

/** Max size of the *resized* cover accepted by the API / signed PUT. */
export const SERVICE_PHOTO_UPLOAD_MAX_BYTES = 2 * 1024 * 1024

/** Longest edge of the stored cover, in pixels. Aspect ratio is preserved. */
export const SERVICE_PHOTO_TARGET_SIZE = 1280

/** WebP quality used when re-encoding a cover in the browser. */
export const SERVICE_PHOTO_WEBP_QUALITY = 0.82

/** Resized cover payload size accepted by the API / signed PUT. */
export const servicePhotoUploadSize = z.number().int().min(1).max(SERVICE_PHOTO_UPLOAD_MAX_BYTES)

export const createServicePhotoUploadInput = z.object({
  contentType: imageContentType,
  size: servicePhotoUploadSize,
})
export type CreateServicePhotoUploadInput = z.infer<typeof createServicePhotoUploadInput>
