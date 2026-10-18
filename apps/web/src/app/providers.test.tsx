import { act, render } from '@testing-library/react'
import { createRealtime, RealtimeProvider } from '@upstash/realtime/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Pins the *pinned library's* reconnect behavior (ADR-025): with the SSE
 * endpoint unreachable, `@upstash/realtime@1.1.0`'s provider retries
 * forever at ~1 s — `connect()` runs `cleanup()`, which resets
 * `reconnectAttemptsRef` to 0, so `maxReconnectAttempts` never accumulates
 * and `status` never settles on `error`. Our pages rely on that cadence
 * plus the periodic reconcile; a library upgrade that fixes the counter
 * (longer backoff, terminal `error`) must be noticed here and reviewed.
 */

class FailingEventSource {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSED = 2
  static instances: FailingEventSource[] = []

  readyState = FailingEventSource.CONNECTING
  onopen: (() => void) | null = null
  onmessage: ((evt: { data: string }) => void) | null = null
  onerror: (() => void) | null = null

  constructor(public url: string) {
    FailingEventSource.instances.push(this)
    // Fail asynchronously — the provider's CLOSED branch (retry path).
    queueMicrotask(() => {
      this.readyState = FailingEventSource.CLOSED
      this.onerror?.()
    })
  }

  close() {
    this.readyState = FailingEventSource.CLOSED
  }
}

const { useRealtime } = createRealtime<{ slot: { occupancy: never } }>()
// The schema shape only types `onData`; a placeholder satisfies the generic.
const useRealtimeAny = useRealtime as unknown as (opts: {
  channels?: string[]
  events?: string[]
  onData?: () => void
  enabled?: boolean
}) => { status: string }

const seenStatuses: string[] = []
function Probe() {
  const { status } = useRealtimeAny({
    channels: ['service:svc-1'],
    events: ['slot.occupancy'],
    onData: () => {},
  })
  seenStatuses.push(status)
  return null
}

describe('RealtimeProvider — pinned retry behavior', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    FailingEventSource.instances = []
    seenStatuses.length = 0
    vi.stubGlobal('EventSource', FailingEventSource)
    // The provider console.logs on every retry — noisy, not signal.
    vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('keeps retrying at ~1s and never settles on error', async () => {
    render(
      <RealtimeProvider api={{ url: '/api/realtime' }}>
        <Probe />
      </RealtimeProvider>,
    )

    // Let the initial debounced connect (25 ms) fire.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100)
    })
    const afterFirst = FailingEventSource.instances.length
    expect(afterFirst).toBeGreaterThanOrEqual(1)

    // Ten more seconds: ~one reconnect per second, still going.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(FailingEventSource.instances.length).toBeGreaterThanOrEqual(afterFirst + 5)
    expect(seenStatuses).not.toContain('error')
  })
})
