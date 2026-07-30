import { z } from 'zod'

import { messengerEnum } from './enums'
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
 */
export const registerOrganizerInput = z.object({
  ticket: authTicket,
  slug,
  name: displayName,
  timezone,
  contact: contact.optional(),
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

/** Profile edits from the cabinet. Messenger identity is not editable. */
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
