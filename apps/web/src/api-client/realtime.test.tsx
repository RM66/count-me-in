import type {
  PublicServiceViewEnvelope,
  ServiceRecord,
  SlotOccupancyEvent,
  TimeSlotRecord,
} from '@repo/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * The browser end of the wire (ADR-025), on a real QueryClient:
 *
 * - an SSE `slot.occupancy` signal invalidates the publicService query
 *   and refetches the authoritative HTTP snapshot;
 * - a malformed SSE payload is ignored without invalidating;
 * - exactly one mount reconcile GET per view: `refetchOnMount` is off
 *   when realtime is on (the first `connected` invalidate does it — the
 *   SDK replays history only from connect time, so the SSR→subscribe
 *   window is only closed by a fetch AFTER the handshake); when realtime
 *   is off, the mount refetch is the reconcile — no `connected` comes.
 *
 * `@upstash/realtime/client` is replaced by a controllable useRealtime:
 * no EventSource, no network — `onData` and `status` are driven directly.
 */

const captured = vi.hoisted(() => ({
  onData: null as null | ((m: { event: string; data: unknown; channel: string }) => void),
  setStatus: null as null | ((s: string) => void),
  channelsSeen: [] as unknown[],
  enabledSeen: [] as boolean[],
}))

vi.mock('@upstash/realtime/client', async () => {
  const React = await import('react')
  return {
    createRealtime: () => ({
      useRealtime: (opts: {
        channels?: unknown[]
        enabled?: boolean
        onData?: (m: { event: string; data: unknown; channel: string }) => void
      }) => {
        const [status, setStatus] = React.useState('disconnected')
        captured.onData = opts.onData ?? null
        captured.setStatus = setStatus
        captured.channelsSeen.push(opts.channels)
        captured.enabledSeen.push(Boolean(opts.enabled))
        return { status }
      },
    }),
  }
})

vi.mock('./client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./client')>()
  return { ...actual, get: vi.fn() }
})

import { get } from './client'
import { queryKeys } from './keys'
import { RealtimeConfiguredProvider, useLivePublicService } from './realtime'

const SERVICE_ID = 'svc-live'
const KEY = queryKeys.publicService.detail(SERVICE_ID)

const slot = (over: Partial<TimeSlotRecord> = {}): TimeSlotRecord =>
  ({
    id: '01930000-0000-7000-8000-0000000000d1',
    serviceId: SERVICE_ID,
    startsAt: '2026-07-25T09:00:00.000Z',
    durationMinutes: 60,
    capacity: 10,
    bookedCount: 0,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as TimeSlotRecord

const view = (slots: TimeSlotRecord[], isDemo = false): PublicServiceViewEnvelope =>
  ({
    service: { id: SERVICE_ID } as ServiceRecord,
    organizer: { id: 'org-1', isDemo },
    slots,
  }) as unknown as PublicServiceViewEnvelope

const event = (over: Partial<SlotOccupancyEvent> = {}): SlotOccupancyEvent => ({
  serviceId: SERVICE_ID,
  organizerId: '01930000-0000-7000-8000-00000000ee02',
  ...over,
})

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

function setup(realtime = true, isDemo = false) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  const initial = view([slot()], isDemo)
  vi.mocked(get).mockResolvedValue(initial)
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <RealtimeConfiguredProvider value={realtime}>{children}</RealtimeConfiguredProvider>
      </QueryClientProvider>
    )
  }
  renderHook(() => useLivePublicService(SERVICE_ID, initial), { wrapper: Wrapper })
  return { queryClient, initial }
}

function emit(e: SlotOccupancyEvent) {
  act(() =>
    captured.onData!({ event: 'slot.occupancy', channel: `service:${SERVICE_ID}`, data: e }),
  )
}

function flip(status: string) {
  act(() => captured.setStatus!(status))
}

beforeEach(() => {
  vi.useFakeTimers()
  setVisibility('visible')
  captured.onData = null
  captured.setStatus = null
  captured.channelsSeen.length = 0
  captured.enabledSeen.length = 0
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useLivePublicService — mount and reconcile budget', () => {
  it('realtime on: no mount refetch — the first connected does the one reconcile GET', async () => {
    setup()
    // refetchOnMount suppressed: nothing fetches until the subscription
    // opens — the connect-time invalidate closes the SSR→subscribe gap.
    expect(get).not.toHaveBeenCalled()
    expect(captured.onData).toBeTruthy()
    expect(captured.enabledSeen).toContain(true)

    flip('connected')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('realtime off: the mount refetch is the reconcile — still one GET', async () => {
    setup(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('demo organizer: disables the SSE subscription and skips the mount refetch', async () => {
    setup(true, true)
    expect(captured.enabledSeen).toEqual([false])
    flip('connected')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(get).not.toHaveBeenCalled()
  })
})

describe('useLivePublicService — event → invalidate', () => {
  it('debounces a burst of valid signals into one refetch', async () => {
    const { queryClient } = setup()
    const updated = view([slot({ bookedCount: 6 })])
    vi.mocked(get).mockResolvedValueOnce(updated)

    emit(event())
    emit(event())
    emit(event())
    expect(get).not.toHaveBeenCalled()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    const cached = queryClient.getQueryData<PublicServiceViewEnvelope>(KEY)!
    expect(cached.slots[0]).toMatchObject({ bookedCount: 6 })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('defers invalidation while hidden and flushes when the tab becomes visible', async () => {
    setup()
    setVisibility('hidden')
    emit(event())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
    })
    expect(get).not.toHaveBeenCalled()

    act(() => {
      setVisibility('visible')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it('ignores a malformed event payload without invalidating', async () => {
    const { queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    act(() =>
      captured.onData!({
        event: 'slot.occupancy',
        channel: `service:${SERVICE_ID}`,
        data: { serviceId: 'bad' },
      }),
    )
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(invalidate).not.toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
  })
})

describe('useLivePublicService — connected transitions', () => {
  it('invalidates on every connected — the first closes the snapshot→subscribe gap', async () => {
    const { queryClient } = setup()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    flip('connected')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(invalidate).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith({ queryKey: KEY })

    flip('disconnected')
    flip('connected')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(invalidate).toHaveBeenCalledTimes(2)
  })
})
