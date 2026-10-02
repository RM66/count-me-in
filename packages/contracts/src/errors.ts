import { z } from 'zod'

/**
 * Fields every error body carries (ADR-024): a human-readable `error` and a
 * machine-readable `code` (the i18n key unless the wire pins another token).
 */
const errorFields = {
  error: z.string(),
  code: z.string(),
}

/**
 * The plain coded-refusal body. `looseObject` because handlers may attach
 * domain extras (sold-out counts today, more later) without a schema edit.
 */
export const errorBody = z.looseObject({
  ...errorFields,
  seatsLeft: z.number().int().optional(),
  maxSeats: z.number().int().optional(),
})
export type ErrorBody = z.infer<typeof errorBody>

export const validationErrors = z.object({
  formErrors: z.array(z.string()),
  fieldErrors: z.record(z.string(), z.array(z.string())),
})
export type ValidationErrors = z.infer<typeof validationErrors>

/** The body-shape failure body: a coded error plus per-field details. */
export const invalidBody = z.object({
  ...errorFields,
  details: validationErrors,
})
export type InvalidBody = z.infer<typeof invalidBody>
