import { z } from 'zod'

import {
  authTicket,
  contact,
  displayName,
  location,
  organizerDescription,
  slug,
  timezone,
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

/** Profile edits from the cabinet. Identity fields (`slug`, messenger) are not editable in MVP. */
export const updateOrganizerProfileInput = z.object({
  name: displayName.optional(),
  timezone: timezone.optional(),
  description: organizerDescription.nullable().optional(),
  location: location.nullable().optional(),
  contact: contact.nullable().optional(),
})
export type UpdateOrganizerProfileInput = z.infer<typeof updateOrganizerProfileInput>
