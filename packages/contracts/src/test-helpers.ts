/**
 * Test-only helpers shared by the vector-driven suites (`vectors.test.ts`,
 * `wire.test.ts`). Not exported from `index.ts` — production code must not
 * depend on them.
 */

/**
 * Recursively expand `$now±N{unit}` string markers into ISO timestamps
 * relative to the current clock. Vectors use them for time-dependent rules
 * (e.g. `startsAtNotPast`) so a frozen fixture never rots.
 */
export function expandNowMarkers(value: unknown): unknown {
  if (typeof value === 'string') {
    const match = /^\$now([+-]\d+)(s|m|h|d)$/.exec(value)
    if (!match) return value
    const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]!]!
    return new Date(Date.now() + Number(match[1]) * unit).toISOString()
  }
  if (Array.isArray(value)) return value.map(expandNowMarkers)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, expandNowMarkers(v)]),
    )
  }
  return value
}
