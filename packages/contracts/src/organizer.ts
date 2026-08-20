import { z } from 'zod'

import { messengerEnum } from './enums'
import { appLocaleEnum, DEFAULT_LOCALE } from './i18n'
import {
  authTicket,
  contact,
  displayName,
  location,
  organizerDescription,
  slug,
  timezone,
  uuid,
} from './primitives'

/**
 * Public registration (ADR-008): messenger identity comes from the auth `ticket`
 * (validated server-side) — never trusted from the client.
 *
 * `language` is the organizer's notification language (ADR-011). Optional in
 * the request (older clients, English fallback); the signup form fills it from
 * the browser locale.
 */
export const registerOrganizerInput = z.object({
  ticket: authTicket,
  slug,
  name: displayName,
  timezone,
  contact: contact.optional(),
  language: appLocaleEnum.optional().default(DEFAULT_LOCALE),
})
export type RegisterOrganizerInput = z.infer<typeof registerOrganizerInput>

/** Organizer profile as returned by the API (cabinet). Dates are ISO strings. */
export const organizerProfile = z.object({
  id: uuid,
  slug,
  name: displayName,
  messenger: messengerEnum,
  messengerId: z.string(),
  timezone,
  description: z.string().nullable(),
  photoUrl: z.string().nullable(),
  location: z.string().nullable(),
  contact: z.string().nullable(),
  /** Notification language: the locale the worker renders this organizer's messages in. */
  language: appLocaleEnum,
  createdAt: z.string(),
  /**
   * Read-only demo account (ADR-010). **Derived** server-side from
   * `DEMO_ORGANIZER_ID` — not a database column, so it cannot desync from the
   * server-side guard. The cabinet uses it to disable inputs and show a banner;
   * enforcement itself lives in the API, never in the UI.
   */
  isDemo: z.boolean(),
})
export type OrganizerProfile = z.infer<typeof organizerProfile>

/**
 * An organizer as the **public booking pages** see them (`/{orgSlug}`).
 * A deliberately narrower projection than {@link organizerProfile}: messenger
 * identity is the login credential (ADR-008) and `createdAt` is bookkeeping,
 * so neither may cross to an unauthenticated visitor.
 */
export const publicOrganizer = z.object({
  id: uuid,
  slug,
  name: displayName,
  timezone,
  description: z.string().nullable(),
  photoUrl: z.string().nullable(),
  location: z.string().nullable(),
  contact: z.string().nullable(),
  /**
   * Read-only demo account (ADR-010), derived server-side from
   * `DEMO_ORGANIZER_ID`. The public page uses it to warn guests before the
   * booking flow; enforcement still lives in the API.
   */
  isDemo: z.boolean(),
})
export type PublicOrganizer = z.infer<typeof publicOrganizer>

/**
 * Profile edits from the cabinet. Messenger identity is not editable.
 * `language` is not here on purpose: the language switcher owns it (ADR-011) —
 * switching while signed in persists `organizers.language` directly.
 */
export const updateOrganizerProfileInput = z.object({
  name: displayName.optional(),
  slug: slug.optional(),
  timezone: timezone.optional(),
  description: organizerDescription.nullable().optional(),
  location: location.nullable().optional(),
  contact: contact.nullable().optional(),
  photoUrl: z.url().nullable().optional(), // null = remove avatar
})
export type UpdateOrganizerProfileInput = z.infer<typeof updateOrganizerProfileInput>
