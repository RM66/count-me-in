/**
 * Cloudflare R2 signed upload helpers.
 * See docs/decisions/007-cloudflare-r2.md
 *
 * Server-only package — never import from client components.
 */

export { getR2Client } from './client'
export { getR2Config } from './env'
export { avatarKey, organizerMediaUrlPrefix, publicUrl, servicePhotoKey } from './keys'
export type { CreateSignedUploadUrlParams, SignedUploadUrl } from './upload'
export { createSignedUploadUrl } from './upload'
