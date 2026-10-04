import type { WebMessages } from '@repo/translations'

/**
 * Type-safe message keys across the app (next-intl v4).
 *
 * next-intl v4 reads the dictionary shape from `AppConfig.Messages` — the
 * pre-v4 `IntlMessages` global augmentation no longer does anything, so keys
 * were silently untyped before this declaration.
 *
 * English is the source of truth: every key added to the `messages/en.json`
 * dictionary in `@repo/translations` becomes available in `useTranslations` /
 * `getTranslations`, and the other dictionaries must provide the same shape
 * (verified by a parity test in the package).
 */
declare module 'next-intl' {
  interface AppConfig {
    Messages: WebMessages
  }
}
