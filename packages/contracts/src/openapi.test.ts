import { describe, expect, it } from 'vitest'

import { JOB_QUEUES } from './jobs'
import { buildOpenApiDocument } from './openapi'
import { API_ROUTES } from './routes'
import { metaOfSchema } from './wire'

describe('OpenAPI jobs receiver', () => {
  it('documents every queue in the manifest as a path-param enum member', () => {
    const runJob = API_ROUTES.find((r) => r.operationId === 'runJob')
    expect(runJob).toBeDefined()
    const queueParam = runJob?.params?.find((p) => p.name === 'queue')
    expect(queueParam).toBeDefined()
    const schema = queueParam?.schema
    expect(schema && 'enum' in schema).toBe(true)
    const queues = schema && 'enum' in schema ? [...(schema.enum as readonly string[])] : []
    expect(queues).toEqual(Object.keys(JOB_QUEUES))
  })

  it('requestBody covers every payload-bearing queue plus the empty body', () => {
    const doc = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { requestBody?: unknown }>>
    }
    const post = doc.paths['/api/jobs/{queue}']?.post
    expect(post?.requestBody).toBeDefined()
    const body = post?.requestBody as {
      content: { 'application/json': { schema: { oneOf: unknown[] } } }
    }
    const oneOf = body.content['application/json'].schema.oneOf
    const payloads = Object.values(JOB_QUEUES).filter((s) => s !== null)
    const hasEmpty = payloads.length < Object.keys(JOB_QUEUES).length
    expect(oneOf).toHaveLength(payloads.length + (hasEmpty ? 1 : 0))
    for (const payload of payloads) {
      expect(oneOf).toContainEqual({
        $ref: `#/components/schemas/${metaOfSchema(payload)!.id}`,
      })
    }
  })
})
