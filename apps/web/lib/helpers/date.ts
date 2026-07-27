/**
 * Date and time formatting utilities.
 * Uses Intl API for locale-aware formatting.
 */

/**
 * Format ISO date string to human-readable date.
 * Example: "Tue, Jul 22"
 */
export function formatDate(iso: string, timezone: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: timezone,
  })
}

/**
 * Format ISO date string to 24-hour time.
 * Example: "09:00"
 */
export function formatTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: timezone,
  })
}

/**
 * Format ISO date string to combined date and time.
 * Example: "Tue, Jul 22 · 09:00"
 */
export function formatDateTime(iso: string, timezone: string): string {
  return `${formatDate(iso, timezone)} · ${formatTime(iso, timezone)}`
}
