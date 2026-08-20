import type { WebMessages } from '@repo/translations'

/**
 * Type-safe message keys across the app (next-intl).
 *
 * English is the source of truth: every key added to the `messages/en.json`
 * dictionary in `@repo/translations` becomes available in `useTranslations` /
 * `getTranslations`, and the Russian dictionary must provide the same shape
 * (verified by a parity test in the package).
 */
type Messages = WebMessages

declare global {
  // The interface body is the point of the declaration — it only *carries*
  // `Messages` into next-intl's key typing, so the empty-body lint rule is
  // disabled for the one line where that is exactly what is wanted.
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface IntlMessages extends Messages {}
}
