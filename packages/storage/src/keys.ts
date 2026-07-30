/**
 * R2 object key builders and URL mapping.
 * Server-only module.
 */
import { randomUUID } from 'node:crypto'

import { getR2Config } from './env'

type ImageExt = 'jpg' | 'png' | 'webp'

/**
 * Generate a versioned avatar key for an organizer.
 * Format: organizers/{organizerId}/avatar-{random}.{ext}
 */
export function avatarKey(organizerId: string, ext: ImageExt): string {
  const random = randomUUID().slice(0, 8)
  return `organizers/${organizerId}/avatar-${random}.${ext}`
}

/**
 * Generate a versioned photo key for a service (for later use).
 * Format: services/{serviceId}/photo-{random}.{ext}
 */
export function servicePhotoKey(serviceId: string, ext: ImageExt): string {
  const random = randomUUID().slice(0, 8)
  return `services/${serviceId}/photo-${random}.${ext}`
}

/**
 * Convert an R2 object key to its public URL.
 */
export function publicUrl(key: string): string {
  const config = getR2Config()
  return `${config.publicBaseUrl}/${key}`
}

/**
 * Get the public URL prefix for all media belonging to an organizer.
 * Used to validate that a client-submitted photoUrl belongs to this organizer.
 */
export function organizerMediaUrlPrefix(organizerId: string): string {
  const config = getR2Config()
  return `${config.publicBaseUrl}/organizers/${organizerId}/`
}
