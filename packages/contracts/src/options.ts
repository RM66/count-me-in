import { z } from 'zod'

import type { OptionsSelectMode } from './enums'
import { optionLabel } from './primitives'

/** Allowed option labels on a service: unique, non-empty list. */
export const optionsList = z
  .array(optionLabel)
  .min(1)
  .max(50)
  .refine((values) => new Set(values).size === values.length, {
    message: 'options must be unique',
  })

/** Shape-only schema for a booking's chosen options (semantic check needs the service). */
export const selectedOptionsShape = z.array(optionLabel).max(50)

interface ServiceOptionsConfig {
  options?: string[] | null
  optionsSelectMode?: OptionsSelectMode | null
}

/**
 * Builds a schema validating a booking's `selectedOptions` against a concrete service.
 * - No service options → selection must be empty (normalized to `null`).
 * - `single` → at most one; `multi` → any subset. Values must exist and be unique.
 */
export function buildSelectedOptionsSchema({ options, optionsSelectMode }: ServiceOptionsConfig) {
  const allowed = new Set(options ?? [])
  const hasOptions = allowed.size > 0

  return z
    .array(optionLabel)
    .optional()
    .transform((values) => values ?? [])
    .superRefine((values, ctx) => {
      if (!hasOptions) {
        if (values.length > 0) {
          ctx.addIssue({ code: 'custom', message: 'this service has no options to select' })
        }
        return
      }
      if (new Set(values).size !== values.length) {
        ctx.addIssue({ code: 'custom', message: 'selectedOptions must not contain duplicates' })
      }
      for (const value of values) {
        if (!allowed.has(value)) {
          ctx.addIssue({
            code: 'custom',
            message: `option "${value}" is not offered by this service`,
          })
        }
      }
      if (optionsSelectMode === 'single' && values.length > 1) {
        ctx.addIssue({ code: 'custom', message: 'this service allows selecting only one option' })
      }
    })
    .transform((values) => (values.length > 0 ? values : null))
}
