import { z } from 'zod'

import { optionsSelectModeEnum } from './enums'
import { optionsList } from './options'
import {
  capacity,
  contact,
  displayName,
  durationMinutes,
  location,
  priceText,
  serviceDescription,
  serviceId,
  uuid,
} from './primitives'

const serviceFields = {
  title: displayName,
  description: serviceDescription.optional(),
  location: location.optional(),
  /** Optional display-only contact; overrides organizer.contact when set. */
  contact: contact.optional(),
  defaultPrice: priceText,
  defaultCapacity: capacity,
  defaultDurationMinutes: durationMinutes,
  options: optionsList.optional(),
  optionsSelectMode: optionsSelectModeEnum.optional(),
}

/**
 * `optionsSelectMode` is required iff the service defines options.
 *
 * `null` counts as "no options": the cabinet clears an option list by sending
 * `options: null` together with `optionsSelectMode: null`, so both absent and
 * explicitly-nulled values must land on the same branch.
 */
function refineOptionsConsistency<T extends z.ZodType>(schema: T) {
  return schema.superRefine((value, ctx) => {
    const { options, optionsSelectMode } = value as {
      options?: string[] | null
      optionsSelectMode?: string | null
    }
    const hasOptions = Array.isArray(options) && options.length > 0
    if (hasOptions && !optionsSelectMode) {
      ctx.addIssue({
        code: 'custom',
        path: ['optionsSelectMode'],
        message: 'optionsSelectMode is required when options are set',
      })
    }
    if (!hasOptions && optionsSelectMode) {
      ctx.addIssue({
        code: 'custom',
        path: ['optionsSelectMode'],
        message: 'optionsSelectMode must be omitted when there are no options',
      })
    }
  })
}

export const createServiceInput = refineOptionsConsistency(
  z.object({
    ...serviceFields,
    /** Public R2 URL of the cover image, already uploaded via a signed URL. */
    photoUrl: z.url().optional(),
  }),
)
export type CreateServiceInput = z.infer<typeof createServiceInput>

/**
 * Cabinet edits. Every optional display field is additionally **nullable**:
 * `undefined` means "leave unchanged", `null` means "clear it". Without that
 * distinction an organizer could never remove a description or a cover photo.
 */
export const updateServiceInput = refineOptionsConsistency(
  z
    .object({
      title: displayName,
      description: serviceDescription.nullable(),
      location: location.nullable(),
      contact: contact.nullable(),
      defaultPrice: priceText,
      defaultCapacity: capacity,
      defaultDurationMinutes: durationMinutes,
      options: optionsList.nullable(),
      optionsSelectMode: optionsSelectModeEnum.nullable(),
      photoUrl: z.url().nullable(), // null = remove cover photo
    })
    .partial(),
)
export type UpdateServiceInput = z.infer<typeof updateServiceInput>

/**
 * A service as returned by the API. Mirrors the `services` table with dates
 * normalized to ISO strings so it can cross the server/client boundary.
 */
export const serviceRecord = z.object({
  id: serviceId,
  organizerId: uuid,
  title: displayName,
  description: z.string().nullable(),
  photoUrl: z.string().nullable(),
  location: z.string().nullable(),
  contact: z.string().nullable(),
  defaultPrice: priceText,
  defaultCapacity: capacity,
  defaultDurationMinutes: durationMinutes,
  options: z.array(z.string()).nullable(),
  optionsSelectMode: optionsSelectModeEnum.nullable(),
  createdAt: z.string(),
})
export type ServiceRecord = z.infer<typeof serviceRecord>

/**
 * Display-field inheritance: a service may override its organizer's `location`
 * and `contact`, and falls back to the organizer's value when it has none.
 *
 * Isomorphic on purpose — the public page renders these, the calendar link
 * embeds the location, and the worker puts both in notification copy, so the
 * override rule cannot live in a component.
 */

interface OverridableDisplayFields {
  location?: string | null
  contact?: string | null
}

/** Location shown for a service: its own, else the organizer's. */
export function effectiveLocation(
  service: OverridableDisplayFields,
  organizer: OverridableDisplayFields,
): string | undefined {
  return service.location ?? organizer.location ?? undefined
}

/** Contact shown for a service: its own, else the organizer's. Same rule as location. */
export function effectiveContact(
  service: OverridableDisplayFields,
  organizer: OverridableDisplayFields,
): string | undefined {
  return service.contact ?? organizer.contact ?? undefined
}
