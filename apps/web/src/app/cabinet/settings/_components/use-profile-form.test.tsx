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
  errorMessage: (e: unknown, fallback: string) =>
    e instanceof Error && e.message ? e.message : fallback,
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

function changeField(
  result: { current: ReturnType<typeof useProfileForm> },
  field: 'name' | 'slug' | 'description' | 'contact' | 'timezone' | 'location',
  value: string,
) {
  act(() => {
    result.current.form.setValue(field, value, { shouldDirty: true })
  })
}

async function save(result: { current: ReturnType<typeof useProfileForm> }) {
  await act(async () => {
    await result.current.save()
  })
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useProfileForm', () => {
  it('starts clean: nothing dirty', () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    expect(result.current.form.formState.isDirty).toBe(false)
  })

  it('sends only changed fields', async () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    changeField(result, 'name', 'New Name')
    expect(result.current.form.formState.isDirty).toBe(true)
    await save(result)
    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(updateMutate.mock.calls[0]![0]).toEqual({ name: 'New Name' })
  })

  it('cleared text arrives as null (clear the column), not empty string', async () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    changeField(result, 'contact', '')
    await save(result)
    expect(updateMutate.mock.calls[0]![0]).toEqual({ contact: null })
  })

  it('reverting a field drops it from the diff', async () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    changeField(result, 'name', 'Changed')
    changeField(result, 'name', 'My Studio')
    expect(result.current.form.formState.isDirty).toBe(false)
    await save(result)
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('save with no changes toasts info and never mutates', async () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    await save(result)
    expect(mockToastInfo).toHaveBeenCalledTimes(1)
    expect(updateMutate).not.toHaveBeenCalled()
  })

  it('invalid values fail client-side validation — nothing leaves', async () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    changeField(result, 'slug', 'ab')
    await save(result)
    expect(updateMutate).not.toHaveBeenCalled()
    expect(mockToastSuccess).not.toHaveBeenCalled()
  })

  it('save mutates the diff; success toasts, re-baselines and calls onSaveSuccess', async () => {
    const onSaveSuccess = vi.fn()
    const { result } = renderHook(() => useProfileForm(makeProfile(), onSaveSuccess), { wrapper })
    changeField(result, 'timezone', 'America/New_York')
    await save(result)
    expect(updateMutate).toHaveBeenCalledTimes(1)
    expect(updateMutate.mock.calls[0]![0]).toEqual({ timezone: 'America/New_York' })

    const options = updateMutate.mock.calls[0]![1] as { onSuccess: () => void }
    act(() => {
      options.onSuccess()
    })
    expect(mockToastSuccess).toHaveBeenCalledTimes(1)
    expect(onSaveSuccess).toHaveBeenCalledTimes(1)
    // The persisted values are the new clean baseline.
    expect(result.current.form.formState.isDirty).toBe(false)
  })

  it('failed save toasts the error', async () => {
    const { result } = renderHook(() => useProfileForm(makeProfile()), { wrapper })
    changeField(result, 'name', 'X')
    await save(result)
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
    changeField(result, 'name', 'Changed')
    expect(result.current.form.formState.isDirty).toBe(true)
    act(() => {
      result.current.form.reset()
    })
    expect(result.current.form.formState.isDirty).toBe(false)
    expect(result.current.form.getValues().name).toBe('My Studio')
  })
})
