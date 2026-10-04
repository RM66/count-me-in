import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IntlTestProvider } from '@/i18n/test-provider'
import { detectLanguage, detectTimezone, SIGNUP_TICKET_KEY, useSignupForm } from './use-signup-form'

// The signup state machine: Telegram auth → profile creation → cabinet.
// Load-bearing rules: the notification language follows the UI locale
// (ADR-011), an expired ticket restarts auth instead of stranding the
// visitor on step 1, and a browser zone missing from the curated list still
// pre-selects — the page adds it to the options rather than blanking the
// Select.

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
  errorMessage: (e: unknown, fallback: string) =>
    e instanceof Error && e.message ? e.message : fallback,
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

afterEach(() => {
  vi.clearAllMocks()
  mockGet.mockImplementation((): string | null => null)
  sessionStorage.clear()
})

describe('detectTimezone', () => {
  it('returns the browser zone verbatim, even when unlisted', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: 'Pacific/Auckland',
    } as Intl.ResolvedDateTimeFormatOptions)
    try {
      expect(detectTimezone()).toBe('Pacific/Auckland')
    } finally {
      vi.restoreAllMocks()
    }
  })

  it('falls back to UTC when the browser reports no zone', () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
      timeZone: undefined,
    } as unknown as Intl.ResolvedDateTimeFormatOptions)
    try {
      expect(detectTimezone()).toBe('UTC')
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

  it('skips to step 1 with a stored ticket and consumes it on read', () => {
    // The login page hands the ticket off through sessionStorage — a
    // one-time credential must not travel in the URL.
    sessionStorage.setItem(SIGNUP_TICKET_KEY, 't-stored')
    const { result } = renderHook(() => useSignupForm(), { wrapper })
    expect(result.current.step).toBe(1)
    expect(result.current.ticket).toBe('t-stored')
    expect(sessionStorage.getItem(SIGNUP_TICKET_KEY)).toBeNull()
  })

  it('successful registration signs in and lands in settings', async () => {
    registerMutateAsync.mockResolvedValue({})
    signInMutateAsync.mockResolvedValue({})
    const { result } = renderHook(() => useSignupForm(), { wrapper })

    act(() => {
      result.current.setTicket('t-1')
      result.current.form.setValue('slug', 'my-studio')
      result.current.form.setValue('name', 'Ann')
      result.current.form.setValue('timezone', 'Europe/Belgrade')
    })
    await act(async () => {
      await result.current.submit()
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

  it('invalid values never reach the API — the contract schema is the client gate', async () => {
    // `formState` is React-state-backed: the React Query subject only emits
    // `errors` updates for keys read during render, so the test subscribes
    // the same way the page does by reading `formState.errors`.
    const { result } = renderHook(
      () => {
        const signup = useSignupForm()
        void signup.form.formState.errors
        return signup
      },
      { wrapper },
    )
    act(() => {
      result.current.setTicket('t-1')
      result.current.form.setValue('slug', 'demo') // a reserved slug
      result.current.form.setValue('name', 'Ann')
    })
    await act(async () => {
      await result.current.submit()
    })
    expect(registerMutateAsync).not.toHaveBeenCalled()
    expect(result.current.form.formState.errors.slug?.message).toBeTruthy()
  })

  it('an expired ticket (401) restarts Telegram auth', async () => {
    const { ApiError } = await import('@/api-client')
    registerMutateAsync.mockRejectedValue(new ApiError('expired', 401))
    const { result } = renderHook(() => useSignupForm(), { wrapper })

    act(() => {
      result.current.setTicket('t-stale')
      result.current.setStep(1)
      result.current.form.setValue('slug', 'my-studio')
      result.current.form.setValue('name', 'Ann')
    })
    await act(async () => {
      await result.current.submit()
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
      result.current.form.setValue('slug', 'my-studio')
      result.current.form.setValue('name', 'Ann')
    })
    await act(async () => {
      await result.current.submit()
    })
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(result.current.step).toBe(1)
    expect(result.current.ticket).toBe('t-1')
  })
})
