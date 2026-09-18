import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { serviceFormSchema } from './service-form'
import { wire, WIRE_SCHEMAS } from './wire'

// Non-wire Zod schemas: the only consumer is the completeness test below, so
// the list lives here — not in wire.ts — keeping form schemas out of the
// client bundle (see api-client/contract.ts, which imports wire for ids).
const TS_ONLY: ReadonlyArray<{ schema: z.ZodType; reason: string }> = [
  {
    schema: serviceFormSchema as unknown as z.ZodType,
    reason: 'форм-схема, не wire; timeSlotFormSchema — функция и в проверку не попадает',
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
      const registered = wire.get(value) !== undefined
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

  it('ids are unique and match WIRE_SCHEMAS keys', () => {
    for (const [id, schema] of Object.entries(WIRE_SCHEMAS)) {
      expect(wire.get(schema)?.id).toBe(id)
    }
  })

  it("kind 'update' schemas accept an empty object", () => {
    for (const [id, schema] of Object.entries(WIRE_SCHEMAS)) {
      if (wire.get(schema)?.kind !== 'update') continue
      expect((schema as z.ZodType).safeParse({}).success, id).toBe(true)
    }
  })

  it("kind 'enum' without x-go-type string covers all options in x-go-enum-consts", () => {
    for (const [id, schema] of Object.entries(WIRE_SCHEMAS)) {
      const meta = wire.get(schema)
      if (meta?.kind !== 'enum' || meta['x-go-type'] === 'string') continue
      const options = (schema as unknown as { options?: readonly string[] }).options ?? []
      const consts = meta['x-go-enum-consts'] ?? {}
      for (const option of options) {
        expect(consts[option], `${id}.${option}`).toBeTruthy()
      }
    }
  })
})
