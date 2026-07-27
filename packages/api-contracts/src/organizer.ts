import { z } from 'zod'

import { messengerEnum } from './enums'
import {
  displayName,
  location,
  organizerDescription,
  otpTicket,
  phone,
  slug,
  timezone,
} from './primitives'

export const createOrganizerInput = z.object({
  slug,
  name: displayName,
  phone,
  timezone,
  description: organizerDescription.optional(),
  location: location.optional(),
  messenger: messengerEnum,
})
export type CreateOrganizerInput = z.infer<typeof createOrganizerInput>

/**
 * Public registration: phone is derived server-side from the OTP `ticket`
 * ([ADR-005](../../docs/decisions/005-phone-messenger.md)) — never trusted from the client.
 */
export const registerOrganizerInput = z.object({
  ticket: otpTicket,
  slug,
  name: displayName,
  timezone,
  messenger: messengerEnum,
})
export type RegisterOrganizerInput = z.infer<typeof registerOrganizerInput>

/** Profile edits from the cabinet. Identity fields (`slug`, `phone`) are not editable in MVP. */
export const updateOrganizerProfileInput = z.object({
  name: displayName.optional(),
  timezone: timezone.optional(),
  description: organizerDescription.nullable().optional(),
  location: location.nullable().optional(),
  messenger: messengerEnum.optional(),
})
export type UpdateOrganizerProfileInput = z.infer<typeof updateOrganizerProfileInput>
