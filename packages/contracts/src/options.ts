import { z } from 'zod'

import { optionLabel } from './primitives'

/** Max options a single service may offer. */
export const OPTIONS_MAX = 50

/**
 * Option labels constrained to a unique list — the shared base of
 * {@link optionsList}, which additionally requires non-empty, and of the
 * service form's options field, where an empty list is legal input.
 * A factory, not a shared instance: every exported Zod schema must be a
 * registered wire shape, and this base is only a building block.
 */
export function uniqueOptionLabels(): z.ZodArray<typeof optionLabel> {
  return z
    .array(optionLabel)
    .max(OPTIONS_MAX)
    .refine((values) => new Set(values).size === values.length, {
      message: 'options must be unique',
    })
}

/** Allowed option labels on a service: unique, non-empty list. */
export const optionsList = uniqueOptionLabels().min(1)

/**
 * Shape-only schema for a booking's chosen options. The semantic check
 * (`validate_selected_options` in the API) bounds a real selection to the
 * service's own list; this only rejects absurd payloads before the service
 * is loaded. Bounded by {@link OPTIONS_MAX} by necessity:
 * a service can never offer more options than that, so a larger selection
 * is always invalid.
 */
export const selectedOptionsShape = z.array(optionLabel).max(OPTIONS_MAX)
