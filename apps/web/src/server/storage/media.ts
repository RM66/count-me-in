/**
 * Ownership validation for client-submitted media URLs.
 *
 * Every `photoUrl` the cabinet sends is just a string, so each write path must
 * confirm it points inside the caller's own R2 prefix. Both avatars and service
 * covers live under `organizers/{organizerId}/` (see `servicePhotoKey`), so a
 * single check covers them.
 */
import { organizerMediaUrlPrefix } from '@repo/media-storage'

import 'server-only'

/**
 * Validate that a media URL belongs to this organizer's prefix.
 * Prevents pointing `photoUrl` at arbitrary hosts or another organizer's media.
 */
export function isOwnMediaUrl(organizerId: string, url: string): boolean {
  return url.startsWith(organizerMediaUrlPrefix(organizerId))
}
