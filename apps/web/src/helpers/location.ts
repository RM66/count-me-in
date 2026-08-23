import { detectContactKind } from './contact'

/**
 * Maps-service link builder.
 *
 * `location` is one free-text string (docs/domain.md). When the organizer
 * already pasted a link (a maps share URL, any http(s) address), it is kept
 * as-is; only plain text gets wrapped in a Google Maps search so the service
 * resolves what was written — an address, a venue name, or both. The universal
 * URL works on desktop and deep-links into the mobile apps.
 */
export function mapSearchUrl(raw: string): string {
  const { kind, href } = detectContactKind(raw)

  if (kind === 'url' && href) {
    return href
  }

  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(raw.trim())}`
}
