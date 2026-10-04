import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IntlTestProvider } from '@/i18n/test-provider'
import { useBookingsTable } from './use-bookings-table'

// The bookings table's non-rendering half: every control writes the URL
// (the API answers the filtered page), and the hook derives the picker's
// marks and labels from what the server returned.

// ── next/navigation mock ──────────────────────────────────────────────────

const mockReplace = vi.fn()
let currentUrl = '/cabinet/bookings'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/cabinet/bookings',
  useSearchParams: () => new URLSearchParams(new URL(currentUrl, 'http://test').search),
}))

/** Re-point the URL the mocked navigation hooks read. */
function setUrl(url: string) {
  currentUrl = url
}

// ── fixtures ──────────────────────────────────────────────────────────────

const slots = [
  {
    id: '01930000-0000-7000-8000-0000000000a1',
    serviceId: 'svc-yoga',
    startsAt: '2026-07-20T05:00:00.000Z',
    durationMinutes: 60,
    capacity: 10,
    bookedCount: 3,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
] as unknown as TimeSlotRecord[]

const services = [
  {
    id: 'svc-yoga',
    organizerId: '01930000-0000-7000-8000-0000000000a9',
    title: 'Morning Yoga',
    description: null,
    photoUrl: null,
    location: null,
    contact: null,
    defaultPrice: '15 EUR',
    defaultCapacity: 10,
    defaultDurationMinutes: 60,
    maxSeatsPerBooking: 4,
    options: null,
    optionsSelectMode: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  },
] as unknown as ServiceRecord[]

function renderTable(overrides: Partial<Parameters<typeof useBookingsTable>[0]> = {}) {
  return renderHook(
    () =>
      useBookingsTable({
        slots,
        services,
        timezone: 'Europe/Belgrade',
        bookedDays: [],
        ...overrides,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <IntlTestProvider>{children}</IntlTestProvider>
      ),
    },
  )
}

afterEach(() => {
  vi.clearAllMocks()
  setUrl('/cabinet/bookings')
})

// ── tests ─────────────────────────────────────────────────────────────────

describe('useBookingsTable — status filter', () => {
  it('writes ?status=confirmed and resets the page', () => {
    setUrl('/cabinet/bookings?page=3')
    const { result } = renderTable()

    act(() => result.current.setFilter('confirmed'))

    expect(mockReplace).toHaveBeenCalledWith('/cabinet/bookings?status=confirmed', {
      scroll: false,
    })
  })

  it('clears the param on "all" but keeps other filters', () => {
    setUrl('/cabinet/bookings?status=cancelled&slot=slot-9')
    const { result } = renderTable({ status: 'cancelled' })

    act(() => result.current.setFilter('all'))

    expect(mockReplace).toHaveBeenCalledWith('/cabinet/bookings?slot=slot-9', { scroll: false })
  })

  it('reports "all" when the URL carries no status', () => {
    const { result } = renderTable()
    expect(result.current.filter).toBe('all')
  })
})

describe('useBookingsTable — day filter', () => {
  it('writes ?day= for a picked day', () => {
    const { result } = renderTable()

    act(() => result.current.setDay('2026-07-22'))

    expect(mockReplace).toHaveBeenCalledWith('/cabinet/bookings?day=2026-07-22', {
      scroll: false,
    })
  })

  it('clears ?day= on an empty selection', () => {
    setUrl('/cabinet/bookings?day=2026-07-22')
    const { result } = renderTable({ day: '2026-07-22' })

    act(() => result.current.setDay(''))

    expect(mockReplace).toHaveBeenCalledWith('/cabinet/bookings', { scroll: false })
  })

  it('labels the active day in the app locale', () => {
    const { result } = renderTable({ day: '2026-07-22' })
    expect(result.current.dayLabel).toBeTruthy()
    expect(result.current.dayLabel).not.toBe('2026-07-22')
  })
})

describe('useBookingsTable — search', () => {
  it('writes ?q= after the debounce, not on each keystroke', () => {
    vi.useFakeTimers()
    try {
      const { result } = renderTable()

      act(() => result.current.setSearch('ann'))
      expect(mockReplace).not.toHaveBeenCalled()

      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(mockReplace).toHaveBeenCalledWith('/cabinet/bookings?q=ann', { scroll: false })
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not navigate when the text matches the URL param', () => {
    vi.useFakeTimers()
    try {
      setUrl('/cabinet/bookings?q=ann')
      renderTable({ query: 'ann' })

      act(() => {
        vi.advanceTimersByTime(600)
      })
      expect(mockReplace).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('clears ?q= when the box is emptied', () => {
    vi.useFakeTimers()
    try {
      setUrl('/cabinet/bookings?q=ann')
      const { result } = renderTable({ query: 'ann' })

      act(() => result.current.setSearch(''))
      act(() => {
        vi.advanceTimersByTime(300)
      })
      expect(mockReplace).toHaveBeenCalledWith('/cabinet/bookings', { scroll: false })
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('useBookingsTable — sort', () => {
  it('cycles a column: unsorted → asc → desc → unsorted', () => {
    const { result, rerender } = renderTable()

    act(() => result.current.toggleSort('guest'))
    expect(mockReplace).toHaveBeenLastCalledWith(
      '/cabinet/bookings?sort=guest&dir=asc',
      expect.anything(),
    )

    // The page navigated — simulate the URL catching up.
    setUrl('/cabinet/bookings?sort=guest&dir=asc')
    rerender()
    const asc = renderTable({ sort: 'guest', dir: 'asc' })
    act(() => asc.result.current.toggleSort('guest'))
    expect(mockReplace).toHaveBeenLastCalledWith(
      '/cabinet/bookings?sort=guest&dir=desc',
      expect.anything(),
    )

    const desc = renderTable({ sort: 'guest', dir: 'desc' })
    setUrl('/cabinet/bookings?sort=guest&dir=desc')
    act(() => desc.result.current.toggleSort('guest'))
    expect(mockReplace).toHaveBeenLastCalledWith('/cabinet/bookings', expect.anything())
  })

  it('reports the active sort for the aria-sort header', () => {
    const { result } = renderTable({ sort: 'when', dir: 'desc' })
    expect(result.current.sortState).toEqual({ key: 'when', dir: 'desc' })
  })

  it('reads a missing dir as ascending', () => {
    const { result } = renderTable({ sort: 'seats' })
    expect(result.current.sortState).toEqual({ key: 'seats', dir: 'asc' })
  })
})

describe('useBookingsTable — pagination', () => {
  it('pageHref preserves every filter and only changes ?page=', () => {
    setUrl('/cabinet/bookings?slot=slot-9&status=confirmed&q=ann&page=2')
    const { result } = renderTable()

    expect(result.current.pageHref(3)).toBe(
      '/cabinet/bookings?slot=slot-9&status=confirmed&q=ann&page=3',
    )
    expect(result.current.pageHref(1)).toBe('/cabinet/bookings?slot=slot-9&status=confirmed&q=ann')
  })
})

describe('useBookingsTable — day marks', () => {
  it('turns scoped day keys into picker dates', () => {
    const { result } = renderTable({ bookedDays: ['2026-07-20', '2026-07-22'] })
    expect(result.current.bookedDates.map((d) => d.getDate())).toEqual([20, 22])
  })

  it('opens the picker on the next booked month, else the last one, else today', () => {
    const future = renderTable({ bookedDays: ['2999-01-15'] })
    expect(future.result.current.defaultMonth.getFullYear()).toBe(2999)

    const past = renderTable({ bookedDays: ['2020-01-15'] })
    expect(past.result.current.defaultMonth.getFullYear()).toBe(2020)

    const empty = renderTable({ bookedDays: [] })
    expect(empty.result.current.defaultMonth.getFullYear()).toBe(new Date().getFullYear())
  })
})
