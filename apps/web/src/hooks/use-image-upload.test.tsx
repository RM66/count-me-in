import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { ApiError } from '@/api-client/error'
import { IntlTestProvider } from '@/i18n/test-provider'
import { useImageUpload } from './use-image-upload'

// The fast local gate before any resizing or network work: wrong type and
// oversize fail here with a toast, the mutation only ever sees candidates.
// No canvas involved — plain File objects suffice.

const mockToastError = vi.fn()
vi.mock('sonner', () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}))

function wrapper({ children }: { children: ReactNode }) {
  return <IntlTestProvider>{children}</IntlTestProvider>
}

function setup(mutationOverrides: Record<string, unknown> = {}) {
  const mutate = vi.fn()
  const onUploaded = vi.fn()
  const { result } = renderHook(
    () =>
      useImageUpload({
        contentType: z.enum(['image/jpeg', 'image/png']),
        maxBytes: 100,
        maxBytesLabel: '100 B',
        mutation: { mutate, isPending: false, ...mutationOverrides } as never,
        onUploaded,
      }),
    { wrapper },
  )
  return { result, mutate, onUploaded }
}

function fileEvent(file: File | null) {
  const input = { files: file ? [file] : [], value: 'picked' } as unknown as HTMLInputElement
  return { target: input } as unknown as React.ChangeEvent<HTMLInputElement>
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('useImageUpload', () => {
  it('ignores an empty pick', () => {
    const { result, mutate } = setup()
    act(() => {
      result.current.onFileChange(fileEvent(null))
    })
    expect(mutate).not.toHaveBeenCalled()
    expect(mockToastError).not.toHaveBeenCalled()
  })

  it('rejects a wrong content type and resets the input', () => {
    const { result, mutate } = setup()
    const event = fileEvent(new File(['x'], 'a.pdf', { type: 'application/pdf' }))
    act(() => {
      result.current.onFileChange(event)
    })
    expect(mutate).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(event.target.value).toBe('')
  })

  it('rejects an oversized file and resets the input', () => {
    const { result, mutate } = setup()
    const event = fileEvent(new File(['x'.repeat(101)], 'big.png', { type: 'image/png' }))
    act(() => {
      result.current.onFileChange(event)
    })
    expect(mutate).not.toHaveBeenCalled()
    expect(mockToastError).toHaveBeenCalledTimes(1)
    expect(event.target.value).toBe('')
  })

  it('forwards a valid file to the mutation', () => {
    const { result, mutate } = setup()
    const file = new File(['x'.repeat(10)], 'ok.png', { type: 'image/png' })
    act(() => {
      result.current.onFileChange(fileEvent(file))
    })
    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]![0]).toBe(file)
  })

  it('upload success calls onUploaded and resets the input', () => {
    const { result, mutate, onUploaded } = setup()
    const event = fileEvent(new File(['x'], 'ok.png', { type: 'image/png' }))
    act(() => {
      result.current.onFileChange(event)
    })
    const options = mutate.mock.calls[0]![1] as { onSuccess: (r: unknown) => void }
    act(() => {
      options.onSuccess({ url: 'https://cdn/x.png' })
    })
    expect(onUploaded).toHaveBeenCalledWith({ url: 'https://cdn/x.png' })
    expect(event.target.value).toBe('')
  })

  it('a 413 maps to the compress-failed copy, other errors to the message', () => {
    const { result, mutate } = setup()
    const event = fileEvent(new File(['x'], 'ok.png', { type: 'image/png' }))
    act(() => {
      result.current.onFileChange(event)
    })
    const options = mutate.mock.calls[0]![1] as { onError: (e: Error) => void }
    act(() => {
      options.onError(new ApiError('too large', 413))
    })
    expect(mockToastError).toHaveBeenCalledTimes(1)
    // 413 never surfaces the raw message — it maps to the compress copy.
    expect(mockToastError).not.toHaveBeenCalledWith('too large')
    act(() => {
      options.onError(new Error('network down'))
    })
    expect(mockToastError).toHaveBeenCalledWith('network down')
  })
})
