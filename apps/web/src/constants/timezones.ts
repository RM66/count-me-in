/**
 * The curated timezone list offered in signup and settings. Values only —
 * labels are generated at render time by {@link timezoneLabel}, because a
 * hardcoded "CET, UTC+1" is wrong half the year (DST) and abbreviations like
 * IST collide (India/Israel/Ireland).
 */
export const TIMEZONES: string[] = [
  // Pacific
  'Pacific/Auckland',
  'Pacific/Fiji',

  // Asia-Pacific
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Brisbane',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Shanghai',
  'Asia/Hong_Kong',
  'Asia/Singapore',
  'Asia/Bangkok',
  'Asia/Dhaka',
  'Asia/Kolkata',
  'Asia/Karachi',
  'Asia/Dubai',
  'Asia/Riyadh',
  'Europe/Moscow',
  'Europe/Istanbul',
  'Asia/Jerusalem',
  'Africa/Cairo',

  // Europe
  'Europe/Athens',
  'Europe/Helsinki',
  'Europe/Belgrade',
  'Europe/Berlin',
  'Europe/Paris',
  'Europe/Rome',
  'Europe/Madrid',
  'Europe/Amsterdam',
  'Europe/Brussels',
  'Europe/Vienna',
  'Europe/Warsaw',
  'Europe/Prague',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Lisbon',

  // Africa
  'Africa/Lagos',
  'Africa/Johannesburg',
  'Africa/Nairobi',

  // Americas
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Toronto',
  'America/Vancouver',
  'America/Mexico_City',
  'America/Bogota',
  'America/Lima',
  'America/Santiago',
  'America/Sao_Paulo',
  'America/Buenos_Aires',
  'Atlantic/Reykjavik',
]

/**
 * Render-time label for a timezone value, e.g. "Europe/Berlin (GMT+2)".
 * The offset comes from `Intl` *now*, so it always reflects the DST half the
 * visitor is actually in, and `shortOffset` is already locale-aware.
 */
export function timezoneLabel(value: string, locale: string): string {
  try {
    const offset = new Intl.DateTimeFormat(locale, {
      timeZone: value,
      timeZoneName: 'shortOffset',
    })
      .formatToParts(new Date())
      .find((part) => part.type === 'timeZoneName')?.value
    const name = value.replace(/_/g, ' ')
    return offset ? `${name} (${offset})` : name
  } catch {
    return value
  }
}
