/**
 * Contact string classifier (ADR-008).
 *
 * The DB stores one free-text `contact` string; this decides which *link kind*
 * renders it. Classification order (first match wins):
 * 1. phone  — E.164-ish / digits with separators  → `tel:` link
 * 2. email  — single valid email address           → `mailto:` link
 * 3. url    — http(s)://, t.me/, www., bare domain → `https:` link (scheme added when missing)
 * 4. text   — anything else                        → plain span, no link
 */

export type ContactKind = 'phone' | 'email' | 'url' | 'text'

export interface ContactInfo {
  kind: ContactKind
  href?: string
}

const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
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

  if (PHONE_RE.test(text)) {
    const digits = text.replace(/[\s\-().]/g, '')
    return { kind: 'phone', href: `tel:${digits}` }
  }

  if (EMAIL_RE.test(text)) {
    return { kind: 'email', href: `mailto:${text}` }
  }

  if (URL_EXPLICIT_RE.test(text)) {
    const href = /^https?:\/\//i.test(text) ? text : `https://${text.replace(/^www\./i, 'www.')}`
    return { kind: 'url', href }
  }
  if (BARE_DOMAIN_RE.test(text)) {
    return { kind: 'url', href: `https://${text}` }
  }

  return { kind: 'text' }
}
