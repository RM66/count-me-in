import type { OrganizerProfile } from '@repo/contracts'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { IntlTestProvider } from '@/i18n/test-provider'
import { useProfileForm } from './use-profile-form'

// The diff is the contract: the update endpoint takes a merge patch where
// absent = keep and null = clear, so unchanged fields must not be sent
// and cleared text must arrive as null, not ''.

const mockToastSuccess = vi.fn()
const mockToastError = vi.fn()
const mockToastInfo = vi.fn()
vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: (...args: unknown[]) => mockToastError(...args),
    info: (...args: unknown[]) => mockToastInfo(...args),
  },
}))

const updateMutate = vi.fn()
vi.mock('@/api-client', () => ({
  useUpdateOrganizerProfile: () => ({ mutate: updateMutate, isPending: false }),
  useUploadAvatar: () => ({ mutate: vi.fn(), isPending: false }),
}))

function wrapper({ children }: { children: ReactNode }) {
  return <IntlTestProvider>{children}</IntlTestProvider>
}

function makeProfile(overrides: Partial<OrganizerProfile> = {}): OrganizerProfile {
  return {
    id: 'org-1',
    slug: 'my-studio',
    name: 'My Studio',
    description: 'Best studio',
    contact: '+123',
    location: 'Belgrade',
    timezone: 'Europe/Belgrade',
    language: 'en',
    ...overrides,
  } as unknown as OrganizerProfile
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useProfileForm', () => {
  it('starts clean: no changes, empty diff', () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    expect(result.current.hasChanges()).toBe(false)
    expect(result.current.getChanges()).toEqual({})
  })

  it('sends only changed fields', () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    act(() => {
      result.current.updateField('name')('New Name')
    })
    expect(result.current.hasChanges()).toBe(true)
    expect(result.current.getChanges()).toEqual({ name: 'New Name' })
  })

  it('cleared text arrives as null (clear the column), not empty string', () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    act(() => {
      result.current.updateField('contact')('')
    })
    expect(result.current.getChanges()).toEqual({ contact: null })
  })

  it('reverting a field drops it from the diff', () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    act(() => {
      result.current.updateField('name')('Changed')
    })
    act(() => {
      result.current.updateField('name')('My Studio')
    })
    expect(result.current.hasChanges()).toBe(false)
  })

  it('save with no changes toasts info and never mutates', () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    act(() => {
      result.current.save()
    })
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('save mutates the diff; success toasts and calls onSaveSuccess', () => {
    const onSaveSuccess = vi.fn()
    const { result } = renderHook(() => useProfileForm(makeProfile(), onSaveSuccess), { wrapper })
    act(() => {
      result.current.updateField('timezone')('America/New_York')
    })
    act(() => {
      result.current.save()
    })
    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(updateMutate.mock.calls[0]![0]).toEqual({ timezone: 'America/New_York' })

    const options = updateMutate.mock.calls[0]![1] as { onSuccess: () => void }
    act(() => {
      options.onSuccess()
    })
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
    expect(onSaveSuccess).toHaveBeenCalledTimes(1)
  })

  it('failed save toasts the error', () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    act(() => {
      result.current.updateField('name')('X')
    })
    act(() => {
      result.current.save()
    })
    const options = updateMutate.mock.calls[0]![1] as {
      onError: (e: Error) => void
    }
    act(() => {
      options.onError(new Error('taken'))
    })
    expect(mockToastError).toHaveBeenCalledTimes(1)
  })

  it('reset restores the loaded profile', () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    act(() => {
      result.current.updateField('name')('Changed')
    })
    expect(result.current.hasChanges()).toBe(true)
    act(() => {
      result.current.reset()
    })
    expect(result.current.hasChanges()).toBe(false)
    expect(result.current.state.name).toBe('My Studio')
  })
})
