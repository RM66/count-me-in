// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * The realtime REST resolver (ADR-025) — the TS twin of
 * `config.realtime_credentials()` in the Python API; the two must
 * answer identically or one side of the wire goes silent.
 */
import { realtimeRestConfig } from './realtime-config'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('realtimeRestConfig', () => {
  it('parses REDIS_REST_URL with the token in userinfo', () => {
    vi.stubEnv('REDIS_REST_URL', 'http://:dev-token@localhost:8080')
    expect(realtimeRestConfig()).toEqual({ url: 'http://localhost:8080', token: 'dev-token' })
    vi.stubEnv('REDIS_REST_URL', 'http://:dev-token@[::1]:8080')
    expect(realtimeRestConfig()).toEqual({ url: 'http://[::1]:8080', token: 'dev-token' })
    vi.stubEnv('REDIS_REST_URL', 'https://tok@rest.example.com:443')
    expect(realtimeRestConfig()).toEqual({ url: 'https://rest.example.com', token: 'tok' })
  })

  it('URL-decodes an encoded token', () => {
    vi.stubEnv('REDIS_REST_URL', 'http://:t%40ken%2F%3F@localhost:8080')
    expect(realtimeRestConfig()).toEqual({ url: 'http://localhost:8080', token: 't@ken/?' })
  })

  it('a set-but-malformed or tokenless REDIS_REST_URL resolves off — no fallthrough', () => {
    vi.stubEnv('REDIS_URL', 'rediss://default:secret@x.upstash.io:6379')
    for (const bad of ['not a url', 'http://localhost:8080', 'redis://x']) {
      vi.stubEnv('REDIS_REST_URL', bad)
      expect(realtimeRestConfig(), bad).toBeNull()
    }
  })

  it('derives the REST pair from an Upstash-shaped REDIS_URL', () => {
    vi.stubEnv('REDIS_URL', 'rediss://default:sec%40ret@x.upstash.io:6379')
    expect(realtimeRestConfig()).toEqual({ url: 'https://x.upstash.io', token: 'sec@ret' })
  })

  it('a non-Upstash or passwordless REDIS_URL resolves off', () => {
    vi.stubEnv('REDIS_URL', 'redis://localhost:6379')
    expect(realtimeRestConfig()).toBeNull()
    vi.stubEnv('REDIS_URL', 'redis://:secret@cache.internal:6379')
    expect(realtimeRestConfig()).toBeNull()
  })

  it('nothing set → null', () => {
    vi.stubEnv('REDIS_REST_URL', '')
    vi.stubEnv('REDIS_URL', '')
    expect(realtimeRestConfig()).toBeNull()
  })
})
