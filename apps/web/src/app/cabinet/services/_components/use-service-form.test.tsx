import type { ServiceRecord } from '@repo/contracts'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IntlTestProvider } from '@/i18n/test-provider'
import { useServiceForm } from './use-service-form'

// The hook owns submission/navigation only — validation and payload
// shaping live in the contracts schemas (service-form.test.ts). Mocks
// stop at the api-client boundary; the resolver runs for real, so a
// submit with invalid values must not reach the mutation.

const mockPush = vi.fn()
const mockRefresh = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
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
const deleteMutate = vi.fn()
vi.mock('@/api-client', () => ({
  useCreateService: () => ({ mutate: createMutate, isPending: false }),
  useUpdateService: () => ({ mutate: updateMutate, isPending: false }),
  useDeleteService: () => ({ mutate: deleteMutate, isPending: false }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <IntlTestProvider>{children}</IntlTestProvider>
}

function makeService(overrides: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    id: 'svc-1',
    organizerId: 'org-1',
    title: 'Yoga',
    description: null,
    photoUrl: null,
    location: null,
    contact: null,
    defaultPrice: '$10',
    defaultCapacity: 10,
    defaultDurationMinutes: 60,
    maxSeatsPerBooking: 4,
    options: null,
    optionsSelectMode: null,
    createdAt: '2025-01-01T00:00:00.000Z',
    ...overrides,
  } as unknown as ServiceRecord
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useServiceForm', () => {
  it('create submit sends the shaped create input', async () => {
    const { result } = renderHook(() => useServiceForm(), { wrapper })
    expect(result.current.isEdit).toBe(false)

    act(() => {
      result.current.form.setValue('title', 'Morning Yoga')
      result.current.form.setValue('defaultPrice', '$12')
    })
    await act(async () => {
      await result.current.submit()
    })

    expect(createMutate).toHaveBeenCalledTimes(1)
    const payload = createMutate.mock.calls[0]![0] as Record<string, unknown>
    expect(payload.title).toBe('Morning Yoga')
    expect(payload.defaultPrice).toBe('$12')
    expect(payload.defaultCapacity).toBe(10)
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('invalid values never reach the mutation', async () => {
    const { result } = renderHook(() => useServiceForm(), { wrapper })
    act(() => {
      result.current.form.setValue('title', '')
    })
    await act(async () => {
      await result.current.submit()
    })
    expect(createMutate).not.toHaveBeenCalled()
  })

  it('edit submit sends the update payload and remove deletes', async () => {
    const { result } = renderHook(() => useServiceForm(makeService()), { wrapper })
    expect(result.current.isEdit).toBe(true)

    act(() => {
      result.current.form.setValue('title', 'Evening Yoga')
    })
    await act(async () => {
      await result.current.submit()
    })
    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(createMutate).not.toHaveBeenCalled()

    act(() => {
      result.current.remove()
    })
    expect(deleteMutate).toHaveBeenCalledTimes(1)
  })

  it('successful writes toast and leave for the list', async () => {
    const { result } = renderHook(() => useServiceForm(), { wrapper })
    act(() => {
      result.current.form.setValue('title', 'Yoga')
      result.current.form.setValue('defaultPrice', '$10')
    })
    await act(async () => {
      await result.current.submit()
    })

    const options = createMutate.mock.calls[0]![1] as {
      onSuccess: () => void
      onError: (e: Error) => void
    }
    act(() => {
      options.onSuccess()
    })
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledWith('/cabinet/services')
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('failed writes toast the error without navigating', async () => {
    const { result } = renderHook(() => useServiceForm(), { wrapper })
    act(() => {
      result.current.form.setValue('title', 'Yoga')
      result.current.form.setValue('defaultPrice', '$10')
    })
    await act(async () => {
      await result.current.submit()
    })

    const options = createMutate.mock.calls[0]![1] as {
      onSuccess: () => void
      onError: (e: Error) => void
    }
    act(() => {
      options.onError(new Error('taken'))
    })
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(mockPush).not.toHaveBeenCalled()
  })
})
