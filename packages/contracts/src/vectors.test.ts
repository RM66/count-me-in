import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { loginLinkKey } from './auth'
import { canCancelBooking } from './booking'
import { isDemoOrganizerId } from './demo'
import { matchLocale } from './i18n'
import { cancelNotificationRecipient } from './jobs'
import { hashManageToken } from './manage-token'
import { buildSelectedOptionsSchema } from './options'
import { API_ROUTES } from './routes'
import { effectiveContact, effectiveLocation } from './service'
import { expandNowMarkers } from './test-helpers'
import { seatsLeft, slotPrice } from './time-slot'
import { metaOfSchema, WIRE_SCHEMAS } from './wire'

const here = dirname(fileURLToPath(import.meta.url))
const validationDir = join(here, '..', 'vectors', 'validation')
const domainDir = join(here, '..', 'vectors', 'domain')

type ValidationCase = {
  name: string
  body: unknown
  valid?: boolean
  fieldErrors?: string[]
  formErrors?: number
  skip?: { ts?: string }
}

function shapeKeys(schema: z.ZodType): string[] {
  // Direct .shape only: a pipe/refine-wrapped input would yield {} here and
  // fail coverage loudly instead of silently disabling per-field checks.
  // (Only wire.test.ts and this coverage check may read Zod internals.)
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
          const result = (zodSchema as z.ZodType).safeParse(expandNowMarkers(c.body))
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
    // Input schemas are exactly the request payloads of the route manifest —
    // a new wire input can never slip through a naming heuristic.
    const inputIds = new Set(
      API_ROUTES.map((route) => route.request)
        .filter((s): s is z.ZodType => s !== undefined)
        .map((s) => {
          const meta = metaOfSchema(s)
          expect(meta, 'route request schema is not registered in wire.ts').toBeDefined()
          return meta!.id
        }),
    )
    for (const id of inputIds) {
      const schema = WIRE_SCHEMAS[id]!
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
              const input = c.selected === null || c.selected === undefined ? undefined : c.selected
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
              expect(
                cancelNotificationRecipient(c.cancelledBy as 'guest' | 'organizer'),
                name,
              ).toBe(c.expected)
              break
            }
            case 'loginLinkKey': {
              expect(loginLinkKey(c.token as string), name).toBe(c.expected)
              break
            }
            case 'hashManageToken': {
              expect(hashManageToken(c.token as string), name).toBe(c.expected)
              break
            }
            case 'canCancelBooking': {
              const expanded = expandNowMarkers(c) as {
                status: 'confirmed' | 'cancelled'
                expiresAt?: string | null
              }
              const expiresAt =
                expanded.expiresAt === null || expanded.expiresAt === undefined
                  ? null
                  : new Date(expanded.expiresAt)
              expect(canCancelBooking(expanded.status, expiresAt), name).toBe(c.expected)
              break
            }
            case 'isDemoOrganizerId': {
              expect(isDemoOrganizerId((c.organizerId as string | null) ?? null), name).toBe(
                c.expected,
              )
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
