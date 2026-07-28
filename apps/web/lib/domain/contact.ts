/**
 * Contact string classifier (ADR-008).
 *
 * The DB stores a single free-text `contact` string. At render time this pure
 * function classifies it so the UI can wrap it in the right link kind.
 *
 * Classification order (first match wins):
 * 1. phone  — E.164-ish / digits with separators  → `tel:` link
 * 2. email  — single valid email address           → `mailto:` link
 * 3. url    — http(s)://, t.me/, www., bare domain → `https:` link (scheme added when missing)
 * 4. text   — anything else                        → plain span, no link
 */

export type ContactKind = 'phone' | 'email' | 'url' | 'text'

export interface ContactInfo {
  kind: ContactKind
  /** Normalised href to use in the anchor (undefined for `text`). */
  href?: string
}

// E.164 / national formats: starts with optional +, then digits, spaces, hyphens, parens.
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/

// Simplified but practical email pattern.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Covers http(s), t.me, www., or bare domain-like strings with a path.
const URL_EXPLICIT_RE = /^(https?:\/\/|t\.me\/|www\.)/i
const BARE_DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*\.)+[a-z]{2,}(\/\S*)?$/i

/**
 * Classify a contact string and return `{ kind, href? }`.
 * Input is trimmed before classification.
 */
export function detectContactKind(raw: string): ContactInfo {
  const text = raw.trim()

  if (!text) {
    return { kind: 'text' }
  }

  // 1. Phone
  if (PHONE_RE.test(text)) {
    // Strip whitespace/formatting for the href; keep leading +.
    const digits = text.replace(/[\s\-().]/g, '')
    return { kind: 'phone', href: `tel:${digits}` }
  }

  // 2. Email
  if (EMAIL_RE.test(text)) {
    return { kind: 'email', href: `mailto:${text}` }
  }

  // 3. URL
  if (URL_EXPLICIT_RE.test(text)) {
    const href = /^https?:\/\//i.test(text) ? text : `https://${text.replace(/^www\./i, 'www.')}`
    return { kind: 'url', href }
  }
  if (BARE_DOMAIN_RE.test(text)) {
    return { kind: 'url', href: `https://${text}` }
  }

  // 4. Plain text
  return { kind: 'text' }
}

/**
 * Returns the effective contact for a service: the service's own `contact`
 * if set, otherwise the organizer's `contact`. Same fallback rule as `location`.
 */
export function effectiveContact(
  serviceContact: string | null | undefined,
  organizerContact: string | null | undefined,
): string | null {
  return serviceContact ?? organizerContact ?? null
}
