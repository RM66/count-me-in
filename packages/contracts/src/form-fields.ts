import { z } from 'zod'

/**
 * Building blocks shared by the cabinet's form schemas.
 *
 * A form schema can never be the wire schema: a controlled input holds a
 * `string` (including `''` mid-edit), while the API takes numbers and uses
 * `null` to clear a column. These two adapters bridge that gap; bounds still
 * come from `primitives.ts`.
 */

/** Optional text field: `''` (untouched or cleared) → `null`, otherwise validated. */
export function optionalText<T extends z.ZodType<string, string>>(schema: T) {
  return z.union([z.literal(''), schema]).transform((value) => (value === '' ? null : value))
}

/**
 * Numeric text field. `z.coerce.number()` would turn `''` into `0` and report
 * "too small" for an empty input, so the empty case is rejected explicitly.
 */
export function numericText<T extends z.ZodType<number, number>>(schema: T, label: string) {
  return z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .transform((value) => Number(value))
    .pipe(z.number({ error: `${label} must be a number` }).pipe(schema))
}
