import { DEMO_ORGANIZER_ID, DEMO_READ_ONLY_CODE } from '@repo/contracts'
import { describe, expect, it, vi } from 'vitest'

// Mock the auth module to avoid pulling in next/server
vi.mock('./auth', () => ({
  auth: vi.fn(),
}))
// getTranslations reads the request-scoped intl config, which does not exist
// in the test env — a key-passthrough keeps the plumbing under test without
// asserting on dictionary copy.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

import { assertNotDemo, DemoReadOnlyError, rejectDemoWrite } from './demo'

// ── rejectDemoWrite ──────────────────────────────────────────────────────────

describe('rejectDemoWrite', () => {
  it('returns a 403 response for the demo organizer id', async () => {
    const res = await rejectDemoWrite(DEMO_ORGANIZER_ID)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns a 403 response for null organizerId', async () => {
    const res = await rejectDemoWrite(null)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns a 403 response for undefined organizerId', async () => {
    const res = await rejectDemoWrite(undefined)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns a localized body with the demo read-only code', async () => {
    const res = await rejectDemoWrite(DEMO_ORGANIZER_ID)
    const body = await res!.json()
    expect(body).toHaveProperty('error')
    expect(body).toHaveProperty('code')
    expect(body.code).toBe(DEMO_READ_ONLY_CODE)
  })

  it('returns null for a real organizer id', async () => {
    const res = await rejectDemoWrite('org-123')
    expect(res).toBeNull()
  })

  it('returns null for a non-demo id that looks similar', async () => {
    const res = await rejectDemoWrite('demo-organizer')
    expect(res).toBeNull()
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
