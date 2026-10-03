import { z } from 'zod'

import { optionalText } from './form-fields'
import type { OrganizerProfile, UpdateOrganizerProfileInput } from './organizer'
import { contact, displayName, location, organizerDescription, slug, timezone } from './primitives'

/**
 * The cabinet settings form, as the *inputs* hold it — the same split as
 * {@link serviceFormSchema}: a controlled input holds `''`, which must reach
 * the API as `null` (clear the column), while the wire schema requires
 * non-empty text. Bounds come from the same primitives the wire schemas use,
 * so the client cannot accept what the server would reject.
 */
export const organizerFormSchema = z.object({
  name: displayName,
  slug,
  description: optionalText(organizerDescription),
  contact: optionalText(contact),
  timezone,
  location: optionalText(location),
})

/** What the inputs hold (all strings). Use for `useForm` values and defaults. */
export type OrganizerFormValues = z.input<typeof organizerFormSchema>

/** What a valid submit produces: trimmed, `''` collapsed to `null`. */
export type OrganizerFormOutput = z.output<typeof organizerFormSchema>

/** Seed the form from the loaded profile: nullable columns become `''`. */
export function toOrganizerFormValues(organizer: OrganizerProfile): OrganizerFormValues {
  return {
    name: organizer.name,
    slug: organizer.slug,
    description: organizer.description ?? '',
    contact: organizer.contact ?? '',
    timezone: organizer.timezone,
    location: organizer.location ?? '',
  }
}

/**
 * Narrow the validated form output to the merge patch: the update endpoint
 * treats an absent key as "keep" and `null` as "clear", so only keys the
 * organizer actually touched may leave the browser — a submit that always
 * sent every field could silently null columns a stale input reverted to `''`.
 * `touched` is `formState.dirtyFields` from react-hook-form.
 */
export function toOrganizerProfilePatch(
  values: OrganizerFormOutput,
  touched: Partial<Record<keyof OrganizerFormValues, boolean>>,
): UpdateOrganizerProfileInput {
  const patch: UpdateOrganizerProfileInput = {}
  if (touched.name) patch.name = values.name
  if (touched.slug) patch.slug = values.slug
  if (touched.description) patch.description = values.description
  if (touched.contact) patch.contact = values.contact
  if (touched.timezone) patch.timezone = values.timezone
  if (touched.location) patch.location = values.location
  return patch
}
