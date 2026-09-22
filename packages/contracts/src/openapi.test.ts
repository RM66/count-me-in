import { describe, expect, it } from 'vitest'

import {
  QUEUE_BOOKING_CANCELLED,
  QUEUE_BOOKING_CREATED,
  QUEUE_DEMO_REFRESH,
  QUEUE_OUTBOX_SWEEP,
} from './jobs'
import { buildOpenApiDocument } from './openapi'
import { API_ROUTES } from './routes'

describe('OpenAPI jobs receiver', () => {
  it('documents every queue from routes.ts', () => {
    const runJob = API_ROUTES.find((r) => r.operationId === 'runJob')
    expect(runJob).toBeDefined()
    const queueParam = runJob?.params?.find((p) => p.name === 'queue')
    expect(queueParam).toBeDefined()
    const schema = queueParam?.schema
    expect(schema && 'enum' in schema).toBe(true)
    const queues = schema && 'enum' in schema ? [...(schema.enum as readonly string[])] : []
    expect(new Set(queues)).toEqual(
      new Set([
        QUEUE_BOOKING_CREATED,
        QUEUE_BOOKING_CANCELLED,
        QUEUE_DEMO_REFRESH,
        QUEUE_OUTBOX_SWEEP,
      ]),
    )
  })

  it('requestBody covers both job payloads and the empty-body queues', () => {
    const doc = buildOpenApiDocument() as {
      paths: Record<string, Record<string, { requestBody?: unknown }>>
    }
    const post = doc.paths['/api/jobs/{queue}']?.post
    expect(post?.requestBody).toBeDefined()
    const body = post?.requestBody as {
      content: { 'application/json': { schema: { oneOf: unknown[] } } }
    }
    const oneOf = body.content['application/json'].schema.oneOf
    expect(oneOf).toHaveLength(3)
    expect(oneOf).toContainEqual({
      $ref: '#/components/schemas/BookingCreatedJob',
    })
    expect(oneOf).toContainEqual({
      $ref: '#/components/schemas/BookingCancelledJob',
    })
  })
})
