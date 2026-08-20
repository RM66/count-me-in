/** Date and time formatting utilities using Intl API. */

import { DEFAULT_LOCALE } from '@repo/contracts'

/**
 * Format ISO date string to human-readable date. Example: "Tue, Jul 22".
 * `locale` is a BCP 47 tag (e.g. `en` / `ru`) — only the *language* of the
 * labels changes; the instant is still rendered in `timezone` (docs/domain.md).
 */
export function formatDate(iso: string, timezone: string, locale: string = DEFAULT_LOCALE): string {
  return new Date(iso).toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  })
}

/** Format ISO date string to 24-hour time. Example: "09:00" */
export function formatTime(iso: string, timezone: string, locale: string = DEFAULT_LOCALE): string {
  return new Date(iso).toLocaleTimeString(locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  })
}

/** Format ISO date string to combined date and time. Example: "Tue, Jul 22 · 09:00" */
export function formatDateTime(
  iso: string,
  timezone: string,
  locale: string = DEFAULT_LOCALE,
): string {
  return `${formatDate(iso, timezone, locale)} · ${formatTime(iso, timezone, locale)}`
}
