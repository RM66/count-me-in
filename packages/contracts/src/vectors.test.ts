import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { loginLinkKey } from './auth'
import { isDemoOrganizerId } from './demo'
import { matchLocale } from './i18n'
import { cancelNotificationRecipient } from './jobs'
import { buildSelectedOptionsSchema } from './options'
import { effectiveContact, effectiveLocation } from './service'
import { seatsLeft, slotPrice } from './time-slot'
import { WIRE_META, WIRE_SCHEMAS } from './wire'

const here = dirname(fileURLToPath(import.meta.url))
const validationDir = join(here, '..', 'vectors', 'validation')
const domainDir = join(here, '..', 'vectors', 'domain')

type ValidationCase = {
  name: string
  body: unknown
  valid?: boolean
  fieldErrors?: string[]
  formErrors?: number
  skip?: { ts?: string; go?: string }
}

function replaceNowMarkers(value: unknown): unknown {
  if (typeof value === 'string') {
    const match = /^\$now([+-]\d+)(s|m|h|d)$/.exec(value)
    if (!match) return value
    const amount = Number(match[1])
    const unit = match[2]
    const ms =
      unit === 's'
        ? amount * 1000
        : unit === 'm'
          ? amount * 60_000
          : unit === 'h'
            ? amount * 3_600_000
            : amount * 86_400_000
    return new Date(Date.now() + ms).toISOString()
  }
  if (Array.isArray(value)) return value.map(replaceNowMarkers)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, replaceNowMarkers(v)]),
    )
  }
  return value
}

function shapeKeys(schema: z.ZodType): string[] {
  // Direct .shape only: a pipe/refine-wrapped input would yield {} here and
  // fail coverage loudly instead of silently disabling per-field checks.
  // (Only wire.test.ts and generator-parity.test.ts may read Zod internals.)
  const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape ?? {}
  return Object.keys(shape)
}

describe('validation vectors', () => {
  const files = readdirSync(validationDir).filter((f) => f.endsWith('.json'))
  for (const file of files) {
    const { schema, cases } = JSON.parse(readFileSync(join(validationDir, file), 'utf8')) as {
      schema: string
      cases: ValidationCase[]
    }
    describe(schema, () => {
      for (const c of cases) {
        it(c.name, () => {
          if (c.skip?.ts) return
          const zodSchema = WIRE_SCHEMAS[schema]
          expect(zodSchema, `unknown schema ${schema}`).toBeDefined()
          const result = (zodSchema as z.ZodType).safeParse(replaceNowMarkers(c.body))
          const valid = result.success
          if (c.valid !== undefined) expect(valid, c.name).toBe(c.valid)
          if (c.fieldErrors !== undefined) {
            const keys = result.success
              ? []
              : Object.keys(z.flattenError(result.error).fieldErrors).sort()
            expect(keys, c.name).toEqual([...c.fieldErrors].sort())
          }
          if (c.formErrors !== undefined) {
            const count = result.success ? 0 : z.flattenError(result.error).formErrors.length
            expect(count, c.name).toBe(c.formErrors)
          }
        })
      }
    })
  }

  it('coverage: every input/update schema has a file, a valid case, and per-field cases', () => {
    const filesBySchema = new Map<string, ValidationCase[]>()
    for (const file of readdirSync(validationDir).filter((f) => f.endsWith('.json'))) {
      const { schema, cases } = JSON.parse(readFileSync(join(validationDir, file), 'utf8')) as {
        schema: string
        cases: ValidationCase[]
      }
      filesBySchema.set(schema, cases)
    }
    for (const [id, schema] of Object.entries(WIRE_SCHEMAS)) {
      const kind = WIRE_META[id]?.kind
      if (kind !== 'input' && kind !== 'update') continue
      const cases = filesBySchema.get(id)
      expect(cases, `missing vectors file for schema ${id}`).toBeDefined()
      expect(
        cases!.some((c) => c.valid === true),
        `schema ${id} has no valid:true case`,
      ).toBe(true)
      for (const key of shapeKeys(schema)) {
        const covered = cases!.some((c) => c.fieldErrors?.includes(key))
        expect(covered, `schema ${id} field ${key} has no fieldErrors case`).toBe(true)
      }
    }
  })
})

type DomainFile = { fn: string; cases: Array<Record<string, unknown>> }

describe('domain vectors', () => {
  const files = readdirSync(domainDir).filter((f) => f.endsWith('.json'))
  for (const file of files) {
    const { fn, cases } = JSON.parse(readFileSync(join(domainDir, file), 'utf8')) as DomainFile
    describe(fn, () => {
      for (const c of cases) {
        const name = String(c.name)
        it(name, () => {
          switch (fn) {
            case 'matchLocale': {
              expect(matchLocale((c.input as string | null) ?? null)).toBe(
                (c.expected as string | null) ?? null,
              )
              break
            }
            case 'validateSelectedOptions': {
              const schema = buildSelectedOptionsSchema({
                options: (c.serviceOptions as string[] | null) ?? null,
                optionsSelectMode: (c.selectMode as 'single' | 'multi' | null) ?? null,
              })
              const input =
                c.selected === null || c.selected === undefined ? undefined : c.selected
              const result = schema.safeParse(input)
              expect(result.success, name).toBe(c.valid)
              if (result.success && 'expectedSelected' in c) {
                expect(result.data, name).toEqual(c.expectedSelected)
              }
              break
            }
            case 'seatsLeft': {
              expect(
                seatsLeft({
                  capacity: c.capacity as number,
                  bookedCount: c.bookedCount as number,
                }),
                name,
              ).toBe(c.expected)
              break
            }
            case 'slotPrice': {
              expect(
                slotPrice(
                  { price: (c.slotPrice as string | null) ?? null },
                  { defaultPrice: (c.serviceDefault as string | null) ?? null },
                ),
                name,
              ).toBe(c.expected)
              break
            }
            case 'effectiveLocation': {
              expect(
                effectiveLocation(
                  { location: (c.service as string | null) ?? null },
                  { location: (c.organizer as string | null) ?? null },
                ),
                name,
              ).toBe((c.expected as string | null) ?? undefined)
              break
            }
            case 'effectiveContact': {
              expect(
                effectiveContact(
                  { contact: (c.service as string | null) ?? null },
                  { contact: (c.organizer as string | null) ?? null },
                ),
                name,
              ).toBe((c.expected as string | null) ?? undefined)
              break
            }
            case 'cancelNotificationRecipient': {
              expect(cancelNotificationRecipient(c.cancelledBy as 'guest' | 'organizer'), name).toBe(
                c.expected,
              )
              break
            }
            case 'loginLinkKey': {
              expect(loginLinkKey(c.token as string), name).toBe(c.expected)
              break
            }
            case 'isDemoOrganizerId': {
              expect(
                isDemoOrganizerId((c.organizerId as string | null) ?? null),
                name,
              ).toBe(c.expected)
              break
            }
            default:
              throw new Error(`unknown domain fn ${fn}`)
          }
        })
      }
    })
  }
})
