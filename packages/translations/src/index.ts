import type { AppLocale } from '@repo/contracts'
import { DEFAULT_LOCALE } from '@repo/contracts'

import messagesDe from '../messages/de.json'
import messagesEn from '../messages/en.json'
import messagesEs from '../messages/es.json'
import messagesFr from '../messages/fr.json'
import messagesJa from '../messages/ja.json'
import messagesPt from '../messages/pt.json'
import messagesRu from '../messages/ru.json'
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
 * Two surfaces, two dictionaries:
 *
 * - {@link WEB_MESSAGES} — the web UI (`apps/web`), namespaced by page and
 *   consumed through next-intl's `useTranslations` / `getTranslations`. The
 *   web's `IntlMessages` global is declared from {@link WebMessages}.
 * - {@link NOTIFICATION_MESSAGES} — the Telegram notifications (`apps/worker`),
 *   consumed through `createTranslator<NotificationMessages>`.
 *
 * English is the source of truth for the *shape* of both: every translated
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
  ru: messagesRu,
  es: messagesEs,
  de: messagesDe,
  ja: messagesJa,
  fr: messagesFr,
  pt: messagesPt,
} as const satisfies Record<AppLocale, unknown>

export const NOTIFICATION_MESSAGES = {
  en: notificationsEn,
  ru: notificationsRu,
  es: notificationsEs,
  de: notificationsDe,
  ja: notificationsJa,
  fr: notificationsFr,
  pt: notificationsPt,
} as const satisfies Record<AppLocale, unknown>

/** The web UI message shape shared by every locale; English keys are the source of truth. */
export type WebMessages = (typeof WEB_MESSAGES)[typeof DEFAULT_LOCALE]

/** The notification message shape shared by every locale; English keys are the source of truth. */
export type NotificationMessages = (typeof NOTIFICATION_MESSAGES)[typeof DEFAULT_LOCALE]
