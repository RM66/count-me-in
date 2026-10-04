/** RFC 5545 (iCalendar) helpers behind the "Add to calendar" .ics download. */

const CRLF = '\r\n'
/** Content lines must not exceed 75 *octets* (RFC 5545 §3.1). */
const FOLD_LIMIT = 75

/** Escape a TEXT value: `\` first, then `;` and `,`, newlines become `\n`. */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n')
}

/**
 * Fold one content line onto ≤75-octet physical lines; continuations start
 * with a single space that counts toward the limit. Folding walks UTF-8
 * boundaries — splitting inside a multi-byte character (or between a
 * surrogate pair) produces a corrupt file.
 */
function foldLine(line: string): string {
  const bytes = new TextEncoder().encode(line)
  if (bytes.length <= FOLD_LIMIT) return line

  const decoder = new TextDecoder()
  const parts: string[] = []
  let start = 0
  let room = FOLD_LIMIT
  while (start < bytes.length) {
    let end = Math.min(start + room, bytes.length)
    // Back off to a UTF-8 boundary: continuation bytes are 10xxxxxx.
    while (end > start && end < bytes.length && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1
    parts.push(decoder.decode(bytes.subarray(start, end)))
    start = end
    room = FOLD_LIMIT - 1
  }
  return parts.join(`${CRLF} `)
}

/** Format an instant as the UTC form `YYYYMMDDTHHMMSSZ` from a real Date. */
export function toIcsDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  )
}

type IcsEvent = {
  /** Stable unique id — the booking id. Required by RFC 5545. */
  uid: string
  title: string
  /** ISO instants. */
  startsAt: string
  endsAt: string
  location?: string
  /** When the file is generated; defaults to now (required DTSTAMP). */
  now?: Date
}

/** Build a complete, spec-valid VCALENDAR document (CRLF, folded lines). */
export function buildIcs({ uid, title, startsAt, endsAt, location, now }: IcsEvent): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CountMeIn//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(now ?? new Date())}`,
    `DTSTART:${toIcsDate(new Date(startsAt))}`,
    `DTEND:${toIcsDate(new Date(endsAt))}`,
    `SUMMARY:${escapeText(title)}`,
    ...(location ? [`LOCATION:${escapeText(location)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return lines.map(foldLine).join(CRLF) + CRLF
}

/**
 * A download-safe filename: keeps Unicode letters/digits, collapses
 * everything else into `-`, and never trusts the title to be non-empty.
 */
export function icsFilename(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/g, '')
  return `${base || 'event'}.ics`
}
