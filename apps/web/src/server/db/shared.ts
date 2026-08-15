/**
 * Shared helpers for the Postgres read/write layer.
 */

import 'server-only'

/**
 * Copy only the keys that are actually **present** in a partial-update payload.
 *
 * The API convention (profile and service endpoints) distinguishes three cases
 * per field: absent = leave untouched, `null` = clear the column, value = write
 * it. `undefined` is therefore the only value that must not reach the `SET`
 * clause, and a plain spread would happily write it as `NULL`.
 *
 * Keys are listed explicitly rather than derived from the input so an extra
 * property on the parsed body can never become a column write.
 */
export function pickDefined<T extends object, K extends keyof T>(
  input: T,
  keys: readonly K[],
): Partial<Pick<T, K>> {
  const updates: Partial<Pick<T, K>> = {}

  for (const key of keys) {
    if (input[key] !== undefined) {
      updates[key] = input[key]
    }
  }

  return updates
}
