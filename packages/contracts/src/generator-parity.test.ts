import { describe, expect, it } from 'vitest'

import { wire, WIRE_SCHEMAS } from './wire'

/**
 * Tripwires for the contracts codegen (stage 4): the generator derives Go
 * rules from JSON Schema constraints, so these two invariants must hold —
 * everything else is pinned by vectors/ and the generated diff itself.
 *
 * (a) every string primitive's .trim() matches its x-go-trim flag
 *     (slug is a pipe: the in-side is checked);
 * (b) every enum's .options order matches its x-go-enum-consts key order.
 *
 * This is the only place in tests that may read _def/_zod.
 */
function zodDef(schema: unknown): { type?: string; in?: unknown; checks?: unknown[] } {
  return (schema as { _zod?: { def?: { type?: string; in?: unknown; checks?: unknown[] } } })._zod
    ?.def ?? {}
}

function hasTrimCheck(schema: unknown): boolean {
  const def = zodDef(schema)
  // Slug is a pipe (lowercase transform): check the in-side.
  const target = def.type === 'pipe' ? zodDef(def.in) : def
  if (target.type !== 'string') return false
  const checks = (target.checks ?? []) as Array<{ _zod?: { def?: { check?: string } } }>
  // In Zod v4 .trim() is an overwrite check.
  return checks.some((c) => c?._zod?.def?.check === 'overwrite')
}

describe('generator tripwires', () => {
  it('x-go-trim matches .trim() on every string primitive', () => {
    for (const [id, schema] of Object.entries(WIRE_SCHEMAS)) {
      const meta = wire.get(schema as never)
      if (meta?.kind !== 'primitive') continue
      expect(hasTrimCheck(schema), `${id} trim`).toBe(meta['x-go-trim'] === true)
    }
  })

  it('enum .options order matches x-go-enum-consts key order', () => {
    for (const [id, schema] of Object.entries(WIRE_SCHEMAS)) {
      const meta = wire.get(schema as never)
      if (meta?.kind !== 'enum' || meta['x-go-type'] === 'string') continue
      const options = (schema as unknown as { options?: readonly string[] }).options ?? []
      expect(Object.keys(meta['x-go-enum-consts'] ?? {}), `${id} const order`).toEqual([...options])
    }
  })
})
