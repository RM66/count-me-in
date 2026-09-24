import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IntlTestProvider } from '@/i18n/test-provider'
import { detectLanguage, detectTimezone, useSignupForm } from './use-signup-form'

// The signup state machine: Telegram auth → profile creation → cabinet.
// Load-bearing rules: the notification language follows the UI locale
// (ADR-011), an expired ticket restarts auth instead of stranding the
// visitor on step 1, and an unknown browser timezone falls back to a
// listed one rather than blanking the Select.

const mockPush = vi.fn()
const mockRefresh = vi.fn()
const mockGet = vi.fn((): string | null => null)
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
  useSearchParams: () => ({ get: mockGet }),
}))

const mockToastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}))

const registerMutateAsync = vi.fn()
const signInMutateAsync = vi.fn()
vi.mock('@/api-client', () => ({
  ApiError: class extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.status = status
    }
  },
  useRegisterOrganizer: () => ({ mutateAsync: registerMutateAsync, isPending: false }),
  useSignInWithTicket: () => ({ mutateAsync: signInMutateAsync, isPending: false }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <IntlTestProvider>{children}</IntlTestProvider>
}

function fakeEvent() {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent
}

afterEach(() => {
  vi.clearAllMocks()
  mockGet.mockImplementation((): string | null => null)
})

describe('detectTimezone', () => {
  it('keeps the browser zone when listed', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Europe/Belgrade',
    } as Intl.ResolvedDateTimeFormatOptions)
    try {
      expect(detectTimezone([{ value: 'Europe/Belgrade' }, { value: 'UTC' }])).toBe(
        'Europe/Belgrade',
      )
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('falls back to a listed zone when the browser zone is unlisted', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Mars/Olympus',
    } as Intl.ResolvedDateTimeFormatOptions)
    try {
      expect(detectTimezone([{ value: 'UTC' }])).toBe('Europe/Belgrade')
    } finally {
      vi.restoreAllMocks()
    }
  })
})

describe('detectLanguage', () => {
  it('follows the UI locale when supported', () => {
    expect(detectLanguage('ru')).toBe('ru')
  })

  it('falls back to English for anything else', () => {
    expect(detectLanguage('xx')).toBe('en')
  })
})

describe('useSignupForm', () => {
  it('starts at step 0 without a ticket param', () => {
    const { result } = renderHook(() => useSignupForm(), { wrapper })
    expect(result.current.step).toBe(0)
  })

  it('skips to step 1 when redirected with a ticket (SIGNUP_REQUIRED flow)', () => {
    mockGet.mockImplementation(() => 't-123')
    const { result } = renderHook(() => useSignupForm(), { wrapper })
    expect(result.current.step).toBe(1)
    expect(result.current.ticket).toBe('t-123')
  })

  it('successful registration signs in and lands in settings', async () => {
    registerMutateAsync.mockResolvedValue({})
    signInMutateAsync.mockResolvedValue({})
    const { result } = renderHook(() => useSignupForm(), { wrapper })

    act(() => {
      result.current.setTicket('t-1')
      result.current.setSlug('my-studio')
      result.current.setName('Ann')
    })
    await act(async () => {
      await result.current.handleCreateAccount(fakeEvent(), 'Europe/Belgrade')
    })

    expect(registerMutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket: 't-1',
        slug: 'my-studio',
        name: 'Ann',
        timezone: 'Europe/Belgrade',
      }),
    )
    expect(signInMutateAsync).toHaveBeenCalledWith('t-1')
    expect(mockPush).toHaveBeenCalledWith('/cabinet/settings')
    expect(mockRefresh).toHaveBeenCalledTimes(1)
  })

  it('an expired ticket (401) restarts Telegram auth', async () => {
    const { ApiError } = await import('@/api-client')
    registerMutateAsync.mockRejectedValue(new ApiError('expired', 401))
    const { result } = renderHook(() => useSignupForm(), { wrapper })

    act(() => {
      result.current.setTicket('t-stale')
      result.current.setStep(1)
    })
    await act(async () => {
      await result.current.handleCreateAccount(fakeEvent(), 'Europe/Belgrade')
    })

    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(result.current.step).toBe(0)
    expect(result.current.ticket).toBe('')
    expect(signInMutateAsync).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('a non-auth failure toasts but keeps the form state', async () => {
    registerMutateAsync.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSignupForm(), { wrapper })
    act(() => {
      result.current.setTicket('t-1')
      result.current.setStep(1)
    })
    await act(async () => {
      await result.current.handleCreateAccount(fakeEvent(), 'Europe/Belgrade')
    })
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(result.current.step).toBe(1)
    expect(result.current.ticket).toBe('t-1')
  })
})
