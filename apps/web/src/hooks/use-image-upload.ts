'use client'

import type { UseMutationResult } from '@tanstack/react-query'
import type { ChangeEvent, RefObject } from 'react'
import { useRef } from 'react'
import { toast } from 'sonner'
import type { z } from 'zod'

type ImageUploadOptions<TResult> = {
  contentType: z.ZodType<string>
  maxBytes: number
  maxBytesLabel: string
  mutation: UseMutationResult<TResult, Error, File>
  onUploaded: (result: TResult) => void
}

type ImageUpload = {
  inputRef: RefObject<HTMLInputElement | null>
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void
  open: () => void
  isUploading: boolean
}

/**
 * Guards a file picker and delegates the upload, shared by the avatar and the
 * service cover. The checks here are a fast local gate on the *source* file so
 * an oversized or unsupported pick fails before any resizing or network work;
 * the API and the signed URL enforce the real limits on the resized payload.
 */
export function useImageUpload<TResult>({
  contentType,
  maxBytes,
  maxBytesLabel,
  mutation,
  onUploaded,
}: ImageUploadOptions<TResult>): ImageUpload {
  const inputRef = useRef<HTMLInputElement>(null)

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target
    const file = input.files?.[0]
    if (!file) return

    const reset = () => {
      input.value = ''
    }

    if (!contentType.safeParse(file.type).success) {
      toast.error('Use a JPEG, PNG or WebP image')
      reset()
      return
    }

    if (file.size > maxBytes) {
      toast.error(`Image must be under ${maxBytesLabel}`)
      reset()
      return
    }

    mutation.mutate(file, {
      onSuccess: (result) => {
        onUploaded(result)
        reset()
      },
      onError: (error) => {
        toast.error(error.message)
        reset()
      },
    })
  }

  return {
    inputRef,
    onFileChange,
    open: () => inputRef.current?.click(),
    isUploading: mutation.isPending,
  }
}
