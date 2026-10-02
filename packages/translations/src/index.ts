import type { AppLocale } from '@repo/contracts'
import { DEFAULT_LOCALE } from '@repo/contracts'

import apiErrorsAr from '../api-errors/ar.json'
import apiErrorsDe from '../api-errors/de.json'
import apiErrorsEn from '../api-errors/en.json'
import apiErrorsEs from '../api-errors/es.json'
import apiErrorsFr from '../api-errors/fr.json'
import apiErrorsJa from '../api-errors/ja.json'
import apiErrorsPt from '../api-errors/pt.json'
import apiErrorsRu from '../api-errors/ru.json'
import messagesAr from '../messages/ar.json'
import messagesDe from '../messages/de.json'
import messagesEn from '../messages/en.json'
import messagesEs from '../messages/es.json'
import messagesFr from '../messages/fr.json'
import messagesJa from '../messages/ja.json'
import messagesPt from '../messages/pt.json'
import messagesRu from '../messages/ru.json'
import notificationsAr from '../notifications/ar.json'
import notificationsDe from '../notifications/de.json'
import notificationsEn from '../notifications/en.json'
import notificationsEs from '../notifications/es.json'
import notificationsFr from '../notifications/fr.json'
import notificationsJa from '../notifications/ja.json'
import notificationsPt from '../notifications/pt.json'
import notificationsRu from '../notifications/ru.json'

/**
 * All user-visible copy in the app, as ICU messages per locale (ADR-011).
 *
 * Lives in a package because copy is data, not plumbing: both apps import it
 * through the same `@repo/*` seam as the contracts, and adding a language is a
 * change in one package, not in two apps.
 *
 * Three surfaces, three dictionaries:
 *
 * - {@link WEB_MESSAGES} — the web UI (`apps/web`), namespaced by page and
 *   consumed through next-intl's `useTranslations` / `getTranslations`. The
 *   web's `IntlMessages` global is declared from {@link WebMessages}.
 * - {@link NOTIFICATION_MESSAGES} — the Telegram notification corpus for the
 *   Python API's QStash job handlers. It reaches Python through
 *   `scripts/generate-i18n-py.ts` → `i18n/translations_gen.py`; on the TS side
 *   it exists for the parity tests.
 * - {@link API_ERROR_MESSAGES} — route error copy, likewise consumed by the
 *   Python API via `translations_gen.py` (`API_ERRORS`). Kept out of
 *   `WEB_MESSAGES` so server-only copy never ships to the browser.
 *
 * English is the source of truth for the *shape* of all three: every translated
 * message mirrors an `en` key, enforced by parity tests. TypeScript infers JSON module
 * types with literal keys, which is what makes `t('...')` calls and the
 * `IntlMessages` augmentation type-safe without a code generator.
 *
 * No `<b>`/`<i>` tags inside messages — use-intl reads tag pairs as rich-text
 * placeholders, so Telegram HTML is composed in code around `t()` results.
 * Emoji are part of the message: they are copy, not markup.
 */

export const WEB_MESSAGES = {
  en: messagesEn,
  de: messagesDe,
  es: messagesEs,
  fr: messagesFr,
  pt: messagesPt,
  ru: messagesRu,
  ar: messagesAr,
  ja: messagesJa,
} as const satisfies Record<AppLocale, unknown>

export const NOTIFICATION_MESSAGES = {
  en: notificationsEn,
  de: notificationsDe,
  es: notificationsEs,
  fr: notificationsFr,
  pt: notificationsPt,
  ru: notificationsRu,
  ar: notificationsAr,
  ja: notificationsJa,
} as const satisfies Record<AppLocale, unknown>

export const API_ERROR_MESSAGES = {
  en: apiErrorsEn,
  de: apiErrorsDe,
  es: apiErrorsEs,
  fr: apiErrorsFr,
  pt: apiErrorsPt,
  ru: apiErrorsRu,
  ar: apiErrorsAr,
  ja: apiErrorsJa,
} as const satisfies Record<AppLocale, unknown>

/** The web UI message shape shared by every locale; English keys are the source of truth. */
export type WebMessages = (typeof WEB_MESSAGES)[typeof DEFAULT_LOCALE]

/** The notification message shape shared by every locale; English keys are the source of truth. */
export type NotificationMessages = (typeof NOTIFICATION_MESSAGES)[typeof DEFAULT_LOCALE]

/** The API error message shape shared by every locale; English keys are the source of truth. */
export type ApiErrorMessages = (typeof API_ERROR_MESSAGES)[typeof DEFAULT_LOCALE]
