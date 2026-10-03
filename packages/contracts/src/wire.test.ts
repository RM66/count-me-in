import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { organizerFormSchema } from './organizer-form'
import { API_ROUTES } from './routes'
import { serviceFormSchema } from './service-form'
import { expandNowMarkers } from './test-helpers'
import { metaOfSchema, WIRE_META, WIRE_SCHEMAS } from './wire'

// Non-wire Zod schemas: the only consumer is the completeness test below, so
// the list lives here — not in wire.ts — keeping form schemas out of the
// client bundle (see api-client/contract.ts, which imports wire for ids).
const TS_ONLY: ReadonlyArray<{ schema: z.ZodType; reason: string }> = [
  {
    schema: serviceFormSchema as unknown as z.ZodType,
    reason: 'form schema, not wire; timeSlotFormSchema is a factory and is not exported',
  },
  {
    schema: organizerFormSchema as unknown as z.ZodType,
    reason: 'form schema, not wire',
  },
]

function isZodType(value: unknown): value is z.ZodType {
  if (value instanceof z.ZodType) return true
  return typeof value === 'object' && value !== null && '_zod' in value
}

describe('wire registry completeness', () => {
  it('every Zod export is registered or listed in TS_ONLY', async () => {
    const mod = await import('./index')
    for (const [name, value] of Object.entries(mod)) {
      if (!isZodType(value)) continue
      const registered = metaOfSchema(value) !== undefined
      const tsOnly = TS_ONLY.some((t) => t.schema === value)
      expect(
        registered || tsOnly,
        `export '${name}' is neither registered in wire.ts nor listed in TS_ONLY`,
      ).toBe(true)
    }
  })

  it('TS_ONLY holds exactly the exported form schemas', () => {
    expect(TS_ONLY).toHaveLength(2)
    for (const { reason } of TS_ONLY) expect(reason).toBeTruthy()
  })

  it('metaOfSchema round-trips every registered id', () => {
    for (const [id, schema] of Object.entries(WIRE_SCHEMAS)) {
      expect(metaOfSchema(schema)?.id, id).toBe(id)
    }
  })

  it('update schemas accept an empty object (merge-patch: an empty patch is a no-op)', () => {
    for (const route of API_ROUTES) {
      if (route.requestContentType !== 'application/merge-patch+json') continue
      expect(route.request?.safeParse({}).success, route.operationId).toBe(true)
    }
  })
})

// The API's decoder consumes `meta.validation` (via rules_gen.py) while the
// Zod schemas carry the behavior — if either side is edited without the
// other, the wire silently diverges. These probes pin both directions:
// every declared rule must be observable on the schema, and every
// observable transform must be declared (ADR-024 C2).
describe('validation metadata ↔ schema parity', () => {
  function shapeOf(schema: z.ZodType): Record<string, z.ZodType> {
    return (schema as unknown as { shape?: Record<string, z.ZodType> }).shape ?? {}
  }

  const TRIM_PROBE = '  zzprobezz  '
  const LOWER_PROBE = 'ZZPROBEZZ'
  const PAST = new Date(Date.now() - 3_600_000).toISOString()
  const FUTURE = new Date(Date.now() + 86_400_000).toISOString()

  const RULE_PROBES: Record<string, { bad: unknown; good: unknown }> = {
    ianaTimezone: { bad: 'Not/AZone', good: 'Europe/Berlin' },
    slugNotReserved: { bad: 'api', good: 'my-studio' },
    httpUrl: { bad: 'ftp://example.com/x', good: 'https://example.com/x' },
    startsAtNotPast: { bad: PAST, good: FUTURE },
  }

  /**
   * Inputs the metadata vocabulary can ever describe: exactly the request
   * schemas of the route manifest — a new input can never slip through a
   * naming heuristic.
   */
  const INPUT_IDS = new Set(
    API_ROUTES.map((route) => route.request)
      .filter((s): s is z.ZodType => s !== undefined)
      .map((s) => metaOfSchema(s)!.id),
  )

  // Rules and refinements live on the *object* schema (superRefine), so
  // probing needs a parseable body: the first valid vector of the schema's
  // own file (the coverage test guarantees one exists).
  const vectorsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'vectors', 'validation')

  function validBase(id: string): Record<string, unknown> {
    const file = JSON.parse(readFileSync(join(vectorsDir, `${id}.json`), 'utf8')) as {
      cases: Array<{ name: string; body: unknown; valid?: boolean }>
    }
    const c = file.cases.find((c) => c.valid === true)
    expect(c, `${id}: no valid:true vector to build probes on`).toBeDefined()
    return expandNowMarkers(c!.body) as Record<string, unknown>
  }

  function errorKeys(result: z.ZodSafeParseResult<unknown>): string[] {
    return result.success ? [] : Object.keys(z.flattenError(result.error).fieldErrors)
  }

  it('declared keys are real schema properties', () => {
    for (const id of INPUT_IDS) {
      const meta = WIRE_META[id]?.validation
      if (!meta) continue
      const shape = shapeOf(WIRE_SCHEMAS[id]!)
      for (const key of [
        ...Object.keys(meta.transforms ?? {}),
        ...Object.keys(meta.fieldRules ?? {}),
        ...(meta.mergedRequired ?? []),
      ]) {
        expect(key in shape, `${id}: metadata references unknown property ${key}`).toBe(true)
      }
    }
  })

  it('declared transforms are observable on the schema', () => {
    for (const id of INPUT_IDS) {
      const meta = WIRE_META[id]?.validation
      const shape = shapeOf(WIRE_SCHEMAS[id]!)
      for (const [field, names] of Object.entries(meta?.transforms ?? {})) {
        const fieldSchema = shape[field]!
        for (const name of names) {
          if (name === 'trim') {
            // String or string-list fields — try both shapes.
            const asString = fieldSchema.safeParse(TRIM_PROBE)
            const asList = fieldSchema.safeParse([TRIM_PROBE])
            const parsed = asString.success ? asString : asList
            expect(parsed.success, `${id}.${field}: trim declared but probe rejects`).toBe(true)
            if (asString.success) {
              expect(
                asString.data,
                `${id}.${field}: trim declared but value kept its padding`,
              ).toBe(TRIM_PROBE.trim())
            } else {
              expect(asList.data).toEqual([TRIM_PROBE.trim()])
            }
          } else if (name === 'lowercase') {
            const parsed = fieldSchema.safeParse(LOWER_PROBE)
            expect(
              parsed.success && parsed.data === LOWER_PROBE.toLowerCase(),
              `${id}.${field}: lowercase declared but ${LOWER_PROBE} did not come back lowercased`,
            ).toBe(true)
          }
        }
      }
    }
  })

  it('a transform the schema applies must be declared (reverse pin)', () => {
    for (const id of INPUT_IDS) {
      const meta = WIRE_META[id]?.validation
      const shape = shapeOf(WIRE_SCHEMAS[id]!)
      for (const [field, fieldSchema] of Object.entries(shape)) {
        // Only observable transforms count: fields that reject the probe
        // (patterns, enums, non-strings) cannot reveal a transform either way.
        const s = fieldSchema.safeParse(TRIM_PROBE)
        if (s.success && typeof s.data === 'string') {
          expect(
            s.data !== TRIM_PROBE ? (meta?.transforms?.[field] ?? []).includes('trim') : true,
            `${id}.${field}: the schema trims but 'trim' is not declared in wire meta`,
          ).toBe(true)
        }
        const l = fieldSchema.safeParse(LOWER_PROBE)
        if (l.success && typeof l.data === 'string') {
          expect(
            l.data === l.data.toLowerCase() && l.data !== LOWER_PROBE
              ? (meta?.transforms?.[field] ?? []).includes('lowercase')
              : true,
            `${id}.${field}: the schema lowercases but 'lowercase' is not declared in wire meta`,
          ).toBe(true)
        }
        const a = fieldSchema.safeParse([TRIM_PROBE])
        if (a.success && Array.isArray(a.data) && a.data.every((v) => typeof v === 'string')) {
          const trimmed = (a.data as string[]).some((v) => v !== TRIM_PROBE)
          expect(
            !trimmed || (meta?.transforms?.[field] ?? []).includes('trim'),
            `${id}.${field}: the schema trims list items but 'trim' is not declared in wire meta`,
          ).toBe(true)
        }
      }
    }
  })

  it('declared field rules reject and accept on the schema', () => {
    for (const id of INPUT_IDS) {
      const meta = WIRE_META[id]?.validation
      if (!meta?.fieldRules) continue
      const schema = WIRE_SCHEMAS[id]!
      const base = validBase(id)
      for (const [field, names] of Object.entries(meta.fieldRules)) {
        for (const name of names) {
          const probe = RULE_PROBES[name]
          expect(probe, `${id}.${field}: unknown field rule ${name}`).toBeDefined()
          if (!probe) continue
          const bad = schema.safeParse({ ...base, [field]: probe.bad })
          expect(
            !bad.success && errorKeys(bad).includes(field),
            `${id}.${field}.${name}: bad probe must land a fieldError on ${field}`,
          ).toBe(true)
          const good = schema.safeParse({ ...base, [field]: probe.good })
          expect(
            good.success || !errorKeys(good).includes(field),
            `${id}.${field}.${name}: good probe must not error on ${field}`,
          ).toBe(true)
        }
      }
    }
  })

  it('declared refinements are observable on the schema', () => {
    for (const id of INPUT_IDS) {
      const meta = WIRE_META[id]?.validation
      for (const name of meta?.refinements ?? []) {
        expect(name, `${id}: unknown refinement ${name}`).toBe('optionsPair')
        // options without a mode must yield an optionsSelectMode issue.
        const base = validBase(id)
        const result = WIRE_SCHEMAS[id]!.safeParse({
          ...base,
          options: ['A'],
          optionsSelectMode: undefined,
        })
        expect(result.success, `${id}: optionsPair must reject options without mode`).toBe(false)
        if (!result.success) {
          expect(
            errorKeys(result),
            `${id}: optionsPair issue must land on optionsSelectMode`,
          ).toContain('optionsSelectMode')
        }
      }
    }
  })
})
