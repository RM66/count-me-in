import { describe, expect, it } from 'vitest'

import { API_ROUTES } from './routes'
import { metaOfSchema, WIRE_META, WIRE_SCHEMAS } from './wire'

describe('API route manifest', () => {
  it('every referenced schema is registered in wire.ts', () => {
    for (const route of API_ROUTES) {
      const schemas = [
        route.request,
        ...route.responses.flatMap((r) => [r.body, ...(r.bodyAnyOf ?? [])]),
        ...(route.params ?? []).map((p) => ('enum' in p.schema ? undefined : p.schema)),
      ].filter((s) => s !== undefined)
      for (const schema of schemas) {
        expect(metaOfSchema(schema), `${route.operationId}`).toBeDefined()
      }
    }
  })

  it('non-HTTP payloads are flagged internal so the spec keeps them reachable', () => {
    const internal = Object.entries(WIRE_META)
      .filter(([, meta]) => meta.internal === true)
      .map(([id]) => id)
    // The Redis payloads that exist today — a new one must opt in by flag,
    // and a flagged schema must still be registered by identity.
    expect(new Set(internal)).toEqual(new Set(['AuthTicketPayload', 'LoginLinkPayload']))
    for (const id of internal) {
      expect(metaOfSchema(WIRE_SCHEMAS[id]!)?.id).toBe(id)
    }
  })

  it('operationIds are unique', () => {
    const ids = API_ROUTES.map((r) => r.operationId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('method+path pairs are unique', () => {
    const pairs = API_ROUTES.map((r) => `${r.method} ${r.path}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('every route declares a 500 — the jobs receiver included (its 500 triggers a QStash retry)', () => {
    for (const route of API_ROUTES) {
      const statuses = route.responses.map((r) => r.status)
      expect(statuses, route.operationId).toContain(500)
    }
  })

  it('a rate-limited route documents 429', () => {
    for (const route of API_ROUTES) {
      if (!route.rateLimit) continue
      expect(
        route.responses.map((r) => r.status),
        route.operationId,
      ).toContain(429)
    }
  })

  it('sessionWritable routes document 403 and never 401', () => {
    for (const route of API_ROUTES) {
      if (route.auth !== 'sessionWritable') continue
      const statuses = route.responses.map((r) => r.status)
      expect(statuses, route.operationId).toContain(403)
      expect(statuses, route.operationId).not.toContain(401)
    }
  })
})
