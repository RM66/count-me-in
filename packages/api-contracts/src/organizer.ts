import { z } from 'zod'
import { messengerEnum } from './enums.js'
import { displayName, organizerDescription, phone, slug, timezone } from './primitives.js'

export const createOrganizerInput = z.object({
  slug,
  name: displayName,
  phone,
  timezone,
  description: organizerDescription.optional(),
  messenger: messengerEnum,
})
export type CreateOrganizerInput = z.infer<typeof createOrganizerInput>

/** Profile edits from the cabinet. Identity fields (`slug`, `phone`) are not editable in MVP. */
export const updateOrganizerProfileInput = z.object({
  name: displayName.optional(),
  timezone: timezone.optional(),
  description: organizerDescription.nullable().optional(),
  messenger: messengerEnum.optional(),
})
export type UpdateOrganizerProfileInput = z.infer<typeof updateOrganizerProfileInput>
