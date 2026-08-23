/**
 * Single source of truth for the site's public domain and origin.
 *
 * Override with `NEXT_PUBLIC_SITE_URL` per environment (e.g. a preview or
 * staging domain); otherwise it falls back to the production domain.
 */
const rawSiteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://countmein.group'

/** Absolute origin, no trailing slash — e.g. `https://countmein.group`. */
export const SITE_URL = rawSiteUrl.replace(/\/$/, '')

/** Bare host without protocol — e.g. `countmein.group`. Use for display. */
export const SITE_DOMAIN = SITE_URL.replace(/^https?:\/\//, '')

export const SITE_NAME = 'CountMeIn'

/** Default SEO title for the site (meta, OpenGraph, Twitter, JSON-LD). */
export const SITE_TITLE = 'CountMeIn — online booking for group events'

export const SUPPORT_EMAIL = `support@${SITE_DOMAIN}`

/** Default SEO description for the site (meta, OpenGraph, Twitter, JSON-LD). */
export const SITE_DESCRIPTION =
  'Publish services with time slots and capacity; guests book on a public page — no account, no app. Simple online booking for group classes, events, and outings.'
