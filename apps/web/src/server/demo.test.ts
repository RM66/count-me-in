import { DEMO_ORGANIZER_ID } from '@repo/api-contracts'
import { describe, expect, it, vi } from 'vitest'

// Mock the auth module to avoid pulling in next/server
vi.mock('./auth', () => ({
  auth: vi.fn(),
}))

import { assertNotDemo, DemoReadOnlyError, demoReadOnlyResponse, rejectDemoWrite } from './demo'

// ── rejectDemoWrite ──────────────────────────────────────────────────────────

describe('rejectDemoWrite', () => {
  it('returns a 403 response for the demo organizer id', () => {
    const res = rejectDemoWrite(DEMO_ORGANIZER_ID)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns a 403 response for null organizerId', () => {
    const res = rejectDemoWrite(null)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns a 403 response for undefined organizerId', () => {
    const res = rejectDemoWrite(undefined)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns null for a real organizer id', () => {
    const res = rejectDemoWrite('org-123')
    expect(res).toBeNull()
  })

  it('returns null for a non-demo id that looks similar', () => {
    const res = rejectDemoWrite('demo-organizer')
    expect(res).toBeNull()
  })
})

// ── demoReadOnlyResponse ──────────────────────────────────────────────────────

describe('demoReadOnlyResponse', () => {
  it('returns a 403 response', () => {
    const res = demoReadOnlyResponse()
    expect(res.status).toBe(403)
  })

  it('includes the error message in the body', async () => {
    const res = demoReadOnlyResponse()
    const body = await res.json()
    expect(body).toHaveProperty('error')
    expect(body).toHaveProperty('code')
  })
})

// ── assertNotDemo ─────────────────────────────────────────────────────────────

describe('assertNotDemo', () => {
  it('throws DemoReadOnlyError for the demo organizer id', () => {
    expect(() => assertNotDemo(DEMO_ORGANIZER_ID)).toThrow(DemoReadOnlyError)
  })

  it('throws DemoReadOnlyError for null', () => {
    expect(() => assertNotDemo(null)).toThrow(DemoReadOnlyError)
  })

  it('throws DemoReadOnlyError for undefined', () => {
    expect(() => assertNotDemo(undefined)).toThrow(DemoReadOnlyError)
  })

  it('does not throw for a real organizer id', () => {
    expect(() => assertNotDemo('org-123')).not.toThrow()
  })
})

// ── DemoReadOnlyError ──────────────────────────────────────────────────────────

describe('DemoReadOnlyError', () => {
  it('is an instance of Error', () => {
    const err = new DemoReadOnlyError()
    expect(err).toBeInstanceOf(Error)
  })

  it('has status 403', () => {
    const err = new DemoReadOnlyError()
    expect(err.status).toBe(403)
  })

  it('has the demo read-only code', () => {
    const err = new DemoReadOnlyError()
    expect(err.code).toBeDefined()
    expect(typeof err.code).toBe('string')
  })

  it('has name DemoReadOnlyError', () => {
    const err = new DemoReadOnlyError()
    expect(err.name).toBe('DemoReadOnlyError')
  })

  it('has a non-empty message', () => {
    const err = new DemoReadOnlyError()
    expect(err.message.length).toBeGreaterThan(0)
  })
})
