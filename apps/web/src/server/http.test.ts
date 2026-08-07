import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

// Mock server-only modules to avoid pulling in next/server
vi.mock('./auth', () => ({
  auth: vi.fn(),
}))
vi.mock('./auth/ticket', () => ({
  consumeTicket: vi.fn(),
}))
vi.mock('./demo', () => ({
  rejectDemoWrite: vi.fn(() => null),
  demoReadOnlyResponse: vi.fn(),
  DemoReadOnlyError: class DemoReadOnlyError extends Error {},
}))

import { parseJsonBody } from './http'

// ── parseJsonBody ────────────────────────────────────────────────────────────

const schema = z.object({
  name: z.string().min(1),
  seats: z.number().int().positive(),
})

describe('parseJsonBody', () => {
  it('returns ok:true with parsed data for valid JSON', async () => {
    const request = new Request('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', seats: 2 }),
    })

    const result = await parseJsonBody(request, schema)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual({ name: 'Test', seats: 2 })
    }
  })

  it('returns ok:false with 400 for invalid JSON', async () => {
    const request = new Request('https://example.com/api', {
      method: 'POST',
      body: 'not json',
    })

    const result = await parseJsonBody(request, schema)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
    }
  })

  it('returns ok:false with 400 for schema violation', async () => {
    const request = new Request('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ name: '', seats: 0 }),
    })

    const result = await parseJsonBody(request, schema)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
      const body = await result.response.json()
      expect(body).toHaveProperty('error')
      expect(body).toHaveProperty('details')
    }
  })

  it('returns ok:false with 400 for missing required fields', async () => {
    const request = new Request('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test' }),
    })

    const result = await parseJsonBody(request, schema)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
    }
  })

  it('returns ok:false with 400 for empty body', async () => {
    const request = new Request('https://example.com/api', {
      method: 'POST',
      body: '',
    })

    const result = await parseJsonBody(request, schema)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
    }
  })

  it('returns ok:false with 400 for null body', async () => {
    const request = new Request('https://example.com/api', {
      method: 'POST',
      body: 'null',
    })

    const result = await parseJsonBody(request, schema)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(400)
    }
  })

  it('includes the first error message in the response', async () => {
    const request = new Request('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify({ name: 123, seats: 'not a number' }),
    })

    const result = await parseJsonBody(request, schema)

    expect(result.ok).toBe(false)
    if (!result.ok) {
      const body = await result.response.json()
      expect(body.error).toBeDefined()
      expect(typeof body.error).toBe('string')
    }
  })

  it('works with a simple string schema', async () => {
    const strSchema = z.string().min(3)
    const request = new Request('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify('hello'),
    })

    const result = await parseJsonBody(request, strSchema)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toBe('hello')
    }
  })

  it('works with an array schema', async () => {
    const arrSchema = z.array(z.number())
    const request = new Request('https://example.com/api', {
      method: 'POST',
      body: JSON.stringify([1, 2, 3]),
    })

    const result = await parseJsonBody(request, arrSchema)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toEqual([1, 2, 3])
    }
  })
})
