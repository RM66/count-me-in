import { buildOpenApiDocument } from '@repo/contracts/openapi'
import { WIRE_SCHEMAS } from '@repo/contracts/wire'
import { describe, expect, it } from 'vitest'

describe('wire registry reachability', () => {
  it('every registered schema is referenced from the document', () => {
    const doc = buildOpenApiDocument() as {
      paths: Record<string, Record<string, unknown>>
      components: { schemas: Record<string, unknown> }
      'x-internal': unknown
    }
    const schemas = doc.components.schemas as Record<string, Record<string, unknown>>

    const refsIn = (value: unknown, acc: Set<string>): void => {
      if (Array.isArray(value)) {
        for (const item of value) refsIn(item, acc)
        return
      }
      if (typeof value !== 'object' || value === null) return
      for (const [key, child] of Object.entries(value)) {
        if (key === '$ref' && typeof child === 'string') {
          const prefix = '#/components/schemas/'
          expect(child.startsWith(prefix), `unexpected $ref ${child}`).toBe(true)
          acc.add(child.slice(prefix.length))
          continue
        }
        refsIn(child, acc)
      }
    }

    const roots = new Set<string>()
    refsIn(doc.paths, roots)
    refsIn(doc['x-internal'], roots)

    const reachable = new Set(roots)
    const queue = [...roots]
    while (queue.length > 0) {
      const id = queue.pop() as string
      const schema = schemas[id]
      expect(schema, `$ref to unknown schema ${id}`).toBeDefined()
      const refs = new Set<string>()
      refsIn(schema, refs)
      for (const ref of refs) {
        if (reachable.has(ref)) continue
        reachable.add(ref)
        queue.push(ref)
      }
    }

    for (const id of Object.keys(WIRE_SCHEMAS)) {
      expect(
        reachable.has(id),
        `schema ${id} is registered but unreachable from paths/x-internal`,
      ).toBe(true)
    }
  })
})
