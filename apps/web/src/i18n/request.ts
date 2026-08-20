import { DEFAULT_LOCALE, matchLocale } from '@repo/contracts'
import { WEB_MESSAGES } from '@repo/translations'
import { cookies, headers } from 'next/headers'
import { getRequestConfig } from 'next-intl/server'

/**
 * Per-request i18n config (ADR-011).
 *
 * Locale is **not** part of the URL — `/{orgSlug}`, `/cabinet` and every deep
 * link serve all languages at the same address. Resolution order per request:
 * the `NEXT_LOCALE` cookie (set by the language switcher) → the
 * `Accept-Language` header → English. The cookie is a pure viewer preference;
 * the booking row and the organizer profile carry the per-person languages the
 * worker needs for notifications.
 *
 * The messages themselves live in `@repo/translations` (ICU JSON per locale);
 * this module only resolves which one applies to this request.
 *
 * Wired by `createNextIntlPlugin` in `next.config.js`; reading cookies here
 * makes every route dynamic, which is already the case for all data-driven
 * pages in this app.
 */

export default getRequestConfig(async () => {
  const cookieStore = await cookies()
  const headerStore = await headers()

  const locale =
    matchLocale(cookieStore.get('NEXT_LOCALE')?.value) ??
    matchLocale(headerStore.get('accept-language')) ??
    DEFAULT_LOCALE

  return {
    locale,
    messages: WEB_MESSAGES[locale],
  }
})
