import { z } from 'zod'

/**
 * Field-set helpers for entities with a create/update wire pair.
 *
 * A *clearable* column is `optional` on create ("not set") and `nullable`
 * on the merge-patch update (RFC 7386: explicit `null` clears it); columns
 * that must always hold a value stay plain and are merely made optional by
 * the update's `.partial()`. Declaring the set once — and deriving both
 * sides from it — keeps the two field lists from drifting apart.
 */

type FieldSet = Record<string, z.ZodType>

/** Create-side wrap: each field becomes `optional` ("absent = not set"). */
export function optionalFields<S extends FieldSet>(
  fields: S,
): { [K in keyof S]: z.ZodOptional<S[K]> } {
  return Object.fromEntries(
    Object.entries(fields).map(([key, schema]) => [key, schema.optional()]),
  ) as { [K in keyof S]: z.ZodOptional<S[K]> }
}

/** Update-side wrap: each field becomes `nullable` ("`null` = clear"); the
 * enclosing `.partial()` adds the "absent = keep" half of merge-patch. */
export function nullableFields<S extends FieldSet>(
  fields: S,
): { [K in keyof S]: z.ZodNullable<S[K]> } {
  return Object.fromEntries(
    Object.entries(fields).map(([key, schema]) => [key, schema.nullable()]),
  ) as { [K in keyof S]: z.ZodNullable<S[K]> }
}
