import { z } from 'zod'

import { messengerEnum } from './enums'
import { appLocaleEnum, DEFAULT_LOCALE } from './i18n'
import { nullableFields } from './merge-patch'
import {
  authTicket,
  contact,
  displayName,
  httpUrl,
  location,
  messengerId,
  organizerDescription,
  slug,
  slugShape,
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

export const internalOrganizerLookupInput = z.object({
  messenger: messengerEnum.optional(),
  messengerId: messengerId.optional(),
  organizerId: uuid.optional(),
})
export type InternalOrganizerLookupInput = z.infer<typeof internalOrganizerLookupInput>

export const registeredOrganizer = z.object({
  id: uuid,
  slug: slugShape,
})
export type RegisteredOrganizer = z.infer<typeof registeredOrganizer>

/** Organizer profile as returned by the API (cabinet). Dates are ISO strings. */
export const organizerProfile = z.object({
  id: uuid,
  slug: slugShape,
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
 * A deliberately narrower projection of {@link organizerProfile}: messenger
 * identity is the login credential (ADR-008) and `createdAt` is bookkeeping,
 * so neither may cross to an unauthenticated visitor — the projection cannot
 * drift from the source record.
 */
export const publicOrganizer = organizerProfile.pick({
  id: true,
  slug: true,
  name: true,
  timezone: true,
  description: true,
  photoUrl: true,
  location: true,
  contact: true,
  isDemo: true,
})
export type PublicOrganizer = z.infer<typeof publicOrganizer>

/** Always-present profile columns — patchable but never clearable to null. */
const requiredProfileFields = {
  name: displayName,
  slug,
  timezone,
}

/** Display fields an organizer may clear: `null` on update empties the column. */
const clearableProfileFields = {
  description: organizerDescription,
  location,
  contact,
  photoUrl: httpUrl, // null = remove avatar
}

/**
 * Profile edits from the cabinet (JSON Merge Patch). Messenger identity is
 * not editable. `language` is not here on purpose: the language switcher owns
 * it (ADR-011) — switching while signed in persists `organizers.language`
 * directly.
 */
export const updateOrganizerProfileInput = z
  .object({
    ...requiredProfileFields,
    ...nullableFields(clearableProfileFields),
  })
  .partial()
export type UpdateOrganizerProfileInput = z.infer<typeof updateOrganizerProfileInput>

/**
 * Language switcher payload (PATCH /api/organizers/me/language, ADR-011).
 * Deliberately not part of {@link updateOrganizerProfileInput}: the switcher
 * owns the `language` column and persists it while signed in.
 */
export const updateOrganizerLanguageInput = z.object({
  language: appLocaleEnum,
})
export type UpdateOrganizerLanguageInput = z.infer<typeof updateOrganizerLanguageInput>
