import { z } from 'zod'

/**
 * Building blocks shared by the cabinet's form schemas.
 *
 * A form schema can never be the wire schema: a controlled input holds a
 * `string` (including `''` mid-edit), while the API takes numbers and uses
 * `null` to clear a column. These two adapters are the whole of that gap, so
 * they live here rather than being re-derived per entity — bounds still come
 * from `primitives.ts`, which keeps client and server rules from drifting.
 */

/** Optional text field: `''` (untouched or cleared) → `null`, otherwise validated. */
export function optionalText<T extends z.ZodType<string, string>>(schema: T) {
  return z.union([z.literal(''), schema]).transform((value) => (value === '' ? null : value))
}

/**
 * Numeric text field. `z.coerce.number()` would turn `''` into `0` and report
 * "too small" for an empty input, so the empty case is rejected explicitly and
 * anything non-numeric is caught before the primitive's bounds apply.
 */
export function numericText<T extends z.ZodType<number, number>>(schema: T, label: string) {
  return (
    z
      .string()
      .trim()
      .min(1, `${label} is required`)
      .transform((value) => Number(value))
      // `z.number()` rejects NaN, which is what a non-numeric input becomes.
      .pipe(z.number({ error: `${label} must be a number` }).pipe(schema))
  )
}
