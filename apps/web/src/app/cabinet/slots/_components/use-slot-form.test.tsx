import type { ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IntlTestProvider } from '@/i18n/test-provider'
import { useSlotForm } from './use-slot-form'

// Submission/navigation only — the wall-clock fold, the past-start rule
// and the adapters are pinned in time-slot-form.test.ts. The resolver
// runs for real, so these tests also prove the seeded defaults submit.

const TZ = 'Europe/Belgrade'

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

const createMutate = vi.fn()
const updateMutate = vi.fn()
vi.mock('@/api-client', () => ({
  useCreateSlot: () => ({ mutate: createMutate, isPending: false }),
  useUpdateSlot: () => ({ mutate: updateMutate, isPending: false }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <IntlTestProvider>{children}</IntlTestProvider>
}

function makeService(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    id: 'svc-001',
    organizerId: 'org-1',
    title: 'Yoga',
    defaultPrice: '$10',
    defaultCapacity: 10,
    defaultDurationMinutes: 60,
    maxSeatsPerBooking: 4,
    ...overrides,
  } as unknown as ServiceRecord
}

function makeSlot(overrides: Partial<TimeSlotRecord> = {}): TimeSlotRecord {
  return {
    id: 'slot-1',
    serviceId: 'svc-001',
    // Past instant: submittable only through the originalStartsAt hatch.
    startsAt: '2020-01-01T06:00:00.000Z',
    durationMinutes: 60,
    capacity: 10,
    price: null,
    createdAt: '2020-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as TimeSlotRecord
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useSlotForm', () => {
  it('create submit sends the shaped create input with a startsAt instant', async () => {
    const { result } = renderHook(
      () => useSlotForm({ services: [makeService()], timezone: TZ, mode: 'create' }),
      { wrapper },
    )
    expect(result.current.isEdit).toBe(false)

    await act(async () => {
      await result.current.submit()
    })
    expect(createMutate).toHaveBeenCalledTimes(1)
    const payload = createMutate.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.serviceId).toBe('svc-001')
    expect(payload.startsAt).toBeInstanceOf(Date)
    expect(payload.capacity).toBe(10)
  })

  it('editing a past slot untouched stays submittable and updates', async () => {
    const { result } = renderHook(
      () =>
        useSlotForm({ services: [makeService()], timezone: TZ, mode: 'edit', slot: makeSlot() }),
      { wrapper },
    )
    await act(async () => {
      await result.current.submit()
    })
    expect(updateMutate).toHaveBeenCalledTimes(1)
    const payload = updateMutate.mock.calls[0]![0] as Record<string, unknown>
    expect(payload).not.toHaveProperty('serviceId')
    expect(createMutate).not.toHaveBeenCalled()
  })

  it('selectService re-seeds untouched capacity/duration from the new service', () => {
    const services = [
      makeService({ id: 'svc-001', defaultCapacity: 10, defaultDurationMinutes: 60 }),
      makeService({ id: 'svc-002', defaultCapacity: 4, defaultDurationMinutes: 30 }),
    ]
    const { result } = renderHook(() => useSlotForm({ services, timezone: TZ, mode: 'create' }), {
      wrapper,
    })
    act(() => {
      result.current.selectService('svc-002')
    })
    expect(result.current.form.getValues('serviceId')).toBe('svc-002')
    expect(result.current.form.getValues('capacity')).toBe('4')
    expect(result.current.form.getValues('durationMinutes')).toBe('30')
  })

  it('selectService preserves a deliberate capacity override', () => {
    const services = [
      makeService({ id: 'svc-001', defaultCapacity: 10, defaultDurationMinutes: 60 }),
      makeService({ id: 'svc-002', defaultCapacity: 4, defaultDurationMinutes: 30 }),
    ]
    // formState is a subscription proxy: the hook consumer must read
    // dirtyFields during render (as the real inputs do via useController),
    // otherwise selectService sees a stale snapshot.
    const { result } = renderHook(
      () => {
        const form = useSlotForm({ services, timezone: TZ, mode: 'create' })
        void form.form.formState.dirtyFields
        return form
      },
      { wrapper },
    )
    act(() => {
      result.current.form.setValue('capacity', '7', { shouldDirty: true })
    })
    // Separate act: dirtyFields is render state — the override must be
    // committed (as a real keystroke would be) before switching service.
    act(() => {
      result.current.selectService('svc-002')
    })
    expect(result.current.form.getValues('capacity')).toBe('7')
    expect(result.current.form.getValues('durationMinutes')).toBe('30')
  })

  it('selectService in edit mode never re-seeds stored values', () => {
    const services = [
      makeService({ id: 'svc-001', defaultCapacity: 10, defaultDurationMinutes: 60 }),
      makeService({ id: 'svc-002', defaultCapacity: 4, defaultDurationMinutes: 30 }),
    ]
    const { result } = renderHook(
      () =>
        useSlotForm({
          services,
          timezone: TZ,
          mode: 'edit',
          slot: makeSlot({ capacity: 12, durationMinutes: 90 }),
        }),
      { wrapper },
    )
    act(() => {
      result.current.selectService('svc-002')
    })
    expect(result.current.form.getValues('capacity')).toBe('12')
    expect(result.current.form.getValues('durationMinutes')).toBe('90')
  })

  it('successful writes toast, call onSuccess and refresh', async () => {
    const onSuccess = vi.fn()
    const { result } = renderHook(
      () => useSlotForm({ services: [makeService()], timezone: TZ, mode: 'create', onSuccess }),
      { wrapper },
    )
    await act(async () => {
      await result.current.submit()
    })
    const options = createMutate.mock.calls[0]![1] as { onSuccess: () => void }
    act(() => {
      options.onSuccess()
    })
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
    expect(onSuccess).toHaveBeenCalledTimes(1)
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })
})
