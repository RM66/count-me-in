import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dateToDayKey } from '@/app/cabinet/_components/day-filter'
import { IntlTestProvider } from '@/i18n/test-provider'
import { useSlotsTable } from './use-slots-table'

// The slots table twin of use-bookings-table.test.ts: service scoping,
// upcoming/past split, day marks that follow the service filter, day
// selection that flips the Upcoming/Past tab, and the delete flow.

const TZ = 'Europe/Belgrade'
// Fixed "now": the day split is a pure string compare against nowIso.
const NOW = '2030-06-15T12:00:00.000Z'

const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}))

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
  },
}))

const deleteMutate = vi.fn()
vi.mock('@/api-client', () => ({
  useDeleteSlot: () => ({ mutate: deleteMutate, isPending: false }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <IntlTestProvider>{children}</IntlTestProvider>
}

function makeSlot(overrides: Partial<TimeSlotRecord> = {}): TimeSlotRecord {
  return {
    id: 'slot-x',
    serviceId: 'svc-001',
    startsAt: '2030-06-16T07:00:00.000Z',
    durationMinutes: 60,
    capacity: 10,
    price: null,
    createdAt: '2030-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as TimeSlotRecord
}

function makeService(id: string): ServiceRecord {
  return { id, title: id } as unknown as ServiceRecord
}

const slots = [
  makeSlot({ id: 's1', serviceId: 'svc-001', startsAt: '2030-06-16T07:00:00.000Z' }),
  makeSlot({ id: 's2', serviceId: 'svc-001', startsAt: '2030-06-14T07:00:00.000Z' }),
  makeSlot({ id: 's3', serviceId: 'svc-002', startsAt: '2030-06-16T08:00:00.000Z' }),
  makeSlot({ id: 's4', serviceId: 'svc-002', startsAt: '2030-06-14T08:00:00.000Z' }),
]
const services = [makeService('svc-001'), makeService('svc-002')]

function renderTable(overrides: Partial<Parameters<typeof useSlotsTable>[0]> = {}) {
  return renderHook(
    () =>
      useSlotsTable({
        slots,
        services,
        timezone: TZ,
        nowIso: NOW,
        ...overrides,
      }),
    { wrapper },
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useSlotsTable', () => {
  it('splits upcoming/past against nowIso', () => {
    const { result } = renderTable()
    expect(result.current.upcoming.map((s) => s.id).sort()).toEqual(['s1', 's3'])
    expect(result.current.past.map((s) => s.id).sort()).toEqual(['s2', 's4'])
    // Past stays behind the toggle, not dropped.
    expect(result.current.visible.map((s) => s.id).sort()).toEqual(['s1', 's3'])
    act(() => {
      result.current.setShowPast(true)
    })
    expect(result.current.visible.map((s) => s.id).sort()).toEqual(['s2', 's4'])
  })

  it('scopes everything by the active service', () => {
    const { result } = renderTable({ activeServiceId: 'svc-001' })
    expect(result.current.scopedByService.map((s) => s.id).sort()).toEqual(['s1', 's2'])
    expect(result.current.activeService?.id).toBe('svc-001')
  })

  it('day marks follow the service filter', () => {
    const { result } = renderTable({ activeServiceId: 'svc-001' })
    const marked = result.current.upcomingDates.map((d) => dateToDayKey(d))
    expect(marked).toHaveLength(1)
    // Unscoped, both services still share the same upcoming day here.
    const { result: all } = renderTable()
    expect(all.current.upcomingDates).toHaveLength(1)
  })

  it('a day with both upcoming and past slots marks as upcoming', () => {
    // Same calendar day, straddling nowIso: the past half must not drag
    // the day into the past marks.
    const pair = [
      makeSlot({ id: 'p1', serviceId: 'svc-001', startsAt: '2030-06-16T07:00:00.000Z' }),
      makeSlot({ id: 'p2', serviceId: 'svc-001', startsAt: '2030-06-16T05:00:00.000Z' }),
    ]
    const { result } = renderHook(
      () =>
        useSlotsTable({ slots: pair, services, timezone: TZ, nowIso: '2030-06-16T06:00:00.000Z' }),
      { wrapper },
    )
    const upcomingKeys = result.current.upcomingDates.map((d) => dateToDayKey(d))
    const pastKeys = result.current.pastDates.map((d) => dateToDayKey(d))
    expect(upcomingKeys).toHaveLength(1)
    // The actionable state wins — the shared day is not marked past.
    expect(pastKeys).toHaveLength(0)
  })

  it('selecting a past-only day flips to the Past tab', () => {
    const { result } = renderTable()
    const pastKey = dateToDayKey(new Date('2030-06-14T12:00:00.000Z'))
    act(() => {
      result.current.selectDay(pastKey)
    })
    expect(result.current.showPast).toBe(true)
  })

  it('selecting an upcoming day flips back to Upcoming', () => {
    const { result } = renderTable()
    act(() => {
      result.current.selectDay(dateToDayKey(new Date('2030-06-14T12:00:00.000Z')))
    })
    expect(result.current.showPast).toBe(true)
    act(() => {
      result.current.selectDay(dateToDayKey(new Date('2030-06-16T12:00:00.000Z')))
    })
    expect(result.current.showPast).toBe(false)
  })

  it('defaultMonth opens on the next session, not the oldest past one', () => {
    const { result } = renderTable()
    // upcomingDates[0] is the earliest upcoming day; defaultMonth is that
    // same calendar day (a local-midnight Date — compare day keys, which
    // are timezone-independent, not instants).
    const [first] = result.current.upcomingDates
    expect(first).toBeDefined()
    expect(dateToDayKey(result.current.defaultMonth)).toBe(dateToDayKey(first!))
  })

  it('confirmDelete deletes, toasts, clears and refreshes', () => {
    const { result } = renderTable()
    act(() => {
      result.current.setPendingDelete(slots[0]!)
    })
    act(() => {
      result.current.confirmDelete()
    })
    expect(deleteMutate).toHaveBeenCalledTimes(1)
    const options = deleteMutate.mock.calls[0]![1] as { onSuccess: () => void }
    act(() => {
      options.onSuccess()
    })
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
    expect(result.current.pendingDelete).toBeNull()
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('failed delete toasts and keeps the pending selection', () => {
    const { result } = renderTable()
    act(() => {
      result.current.setPendingDelete(slots[0]!)
    })
    act(() => {
      result.current.confirmDelete()
    })
    const options = deleteMutate.mock.calls[0]![1] as {
      onError: (e: Error) => void
    }
    act(() => {
      options.onError(new Error('nope'))
    })
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(result.current.pendingDelete).not.toBeNull()
    expect(mockRefresh).not.toHaveBeenCalled()
  })
})
