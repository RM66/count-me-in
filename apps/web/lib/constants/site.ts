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
