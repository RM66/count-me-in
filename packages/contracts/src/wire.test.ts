import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { serviceFormSchema } from './service-form'
import { metaOfSchema, WIRE_SCHEMAS } from './wire'

// Non-wire Zod schemas: the only consumer is the completeness test below, so
// the list lives here — not in wire.ts — keeping form schemas out of the
// client bundle (see api-client/contract.ts, which imports wire for ids).
const TS_ONLY: ReadonlyArray<{ schema: z.ZodType; reason: string }> = [
  {
    schema: serviceFormSchema as unknown as z.ZodType,
    reason: 'form schema, not wire; timeSlotFormSchema is a factory and is not exported',
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

  it('TS_ONLY holds exactly serviceFormSchema', () => {
    expect(TS_ONLY).toHaveLength(1)
    expect(TS_ONLY[0]?.reason).toBeTruthy()
  })

  it('metaOfSchema round-trips every registered id', () => {
    for (const [id, schema] of Object.entries(WIRE_SCHEMAS)) {
      expect(metaOfSchema(schema)?.id, id).toBe(id)
    }
  })

  it('update schemas accept an empty object (merge-patch: an empty patch is a no-op)', () => {
    for (const id of ['UpdateServiceInput', 'UpdateTimeSlotInput', 'UpdateOrganizerProfileInput']) {
      const schema = WIRE_SCHEMAS[id] as z.ZodType
      expect(schema.safeParse({}).success, id).toBe(true)
    }
  })
})
