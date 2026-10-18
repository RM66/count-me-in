import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * CabinetLive (ADR-025): an occupancy event, a (re)connect or a focus —
 * debounced into one `router.refresh()`; the 120 s periodic reconcile is
 * the missed-emit fallback. The first `connected` refreshes too: the
 * SSR-read → subscribe-open window is never replayed. Refreshes pause
 * while the tab is hidden.
 */

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

type ChannelProps = {
  channel?: string
  enabled: boolean
  onEvent: () => void
  onConnected?: () => void
}
const channelSpy = vi.fn()
vi.mock('@/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api-client')>()
  return {
    ...actual,
    useCurrentOrganizer: () => ({ data: currentOrganizer }),
    useRealtimeConfigured: () => realtimeConfigured,
    useSlotOccupancyChannel: (props: ChannelProps) => {
      channelSpy(props)
      lastChannelProps = props
    },
  }
})

let currentOrganizer: { id: string; isDemo: boolean } | undefined
let realtimeConfigured = true
let lastChannelProps: ChannelProps | undefined

import { CabinetLive } from './cabinet-live'

const ORGANIZER = { id: 'org-1', isDemo: false }

function mount() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <CabinetLive />
    </QueryClientProvider>,
  )
}

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
}

beforeEach(() => {
  vi.useFakeTimers()
  mockRefresh.mockReset()
  channelSpy.mockReset()
  lastChannelProps = undefined
  currentOrganizer = ORGANIZER
  realtimeConfigured = true
  setVisibility('visible')
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CabinetLive', () => {
  it('subscribes to the organizer channel when realtime is configured', () => {
    mount()
    expect(lastChannelProps).toMatchObject({ channel: 'organizer:org-1', enabled: true })
  })

  it('does not subscribe for the demo organizer or when realtime is off', () => {
    currentOrganizer = { id: 'demo-id', isDemo: true }
    mount()
    expect(lastChannelProps).toMatchObject({ enabled: false })

    channelSpy.mockClear()
    currentOrganizer = ORGANIZER
    realtimeConfigured = false
    mount()
    expect(lastChannelProps).toMatchObject({ enabled: false })
  })

  it('debounces a burst of events into one refresh', () => {
    mount()
    act(() => {
      lastChannelProps!.onEvent()
      lastChannelProps!.onEvent()
      lastChannelProps!.onEvent()
    })
    expect(mockRefresh).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(500))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes on the initial connect — the SSR→subscribe window is not replayed', () => {
    mount()
    act(() => {
      lastChannelProps!.onConnected?.()
    })
    act(() => vi.advanceTimersByTime(500))
    expect(mockRefresh).toHaveBeenCalledTimes(1)

    act(() => {
      lastChannelProps!.onConnected?.()
    })
    act(() => vi.advanceTimersByTime(500))
    expect(mockRefresh).toHaveBeenCalledTimes(2)
  })

  it('refreshes periodically while visible and pauses while hidden', () => {
    mount()
    // The interval schedules the debounced refresh — run the debounce too.
    act(() => vi.advanceTimersByTime(120_000 + 500))
    expect(mockRefresh).toHaveBeenCalled()

    mockRefresh.mockClear()
    setVisibility('hidden')
    act(() => vi.advanceTimersByTime(240_000))
    expect(mockRefresh).not.toHaveBeenCalled()

    // Coming back flushes the pending refresh.
    act(() => {
      setVisibility('visible')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => vi.advanceTimersByTime(500))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('an armed debounce folds into pending when the tab hides', () => {
    mount()
    act(() => {
      lastChannelProps!.onEvent()
    })
    // Hide before the 400 ms debounce fires — the timer must not land
    // its refresh on the hidden tab.
    act(() => {
      setVisibility('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => vi.advanceTimersByTime(1000))
    expect(mockRefresh).not.toHaveBeenCalled()

    act(() => {
      setVisibility('visible')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => vi.advanceTimersByTime(500))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('queues events received while hidden for the next visible', () => {
    mount()
    setVisibility('hidden')
    act(() => {
      lastChannelProps!.onEvent()
    })
    act(() => vi.advanceTimersByTime(1000))
    expect(mockRefresh).not.toHaveBeenCalled()

    act(() => {
      setVisibility('visible')
      document.dispatchEvent(new Event('visibilitychange'))
    })
    act(() => vi.advanceTimersByTime(500))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('refreshes when the window regains focus while visible', () => {
    mount()
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    act(() => vi.advanceTimersByTime(500))
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})
