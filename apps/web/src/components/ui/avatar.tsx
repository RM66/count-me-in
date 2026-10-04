'use client'

import NextImage, { type ImageProps } from 'next/image'
import { Avatar as AvatarPrimitive } from 'radix-ui'
import {
  ComponentProps,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'

import { cn } from '@/lib/utils'
import { MakeOptional, MakeRequired } from '@/types'

type AvatarImageStatus = 'loading' | 'loaded' | 'error'

type AvatarContextValue = {
  hasImage: boolean
  imageStatus: AvatarImageStatus
  registerImage: () => void
  setImageStatus: (status: AvatarImageStatus) => void
}

/**
 * `AvatarImage` renders through next/image, so Radix never sees the
 * underlying `<img>` and its own loading-status machinery cannot drive the
 * fallback. The root holds the status instead: the fallback mounts while
 * the image loads and after it errors, and unmounts once it is painted —
 * otherwise the initials would sit (and be announced) underneath every
 * successful photo.
 */
const AvatarContext = createContext<AvatarContextValue>({
  hasImage: false,
  imageStatus: 'loading',
  registerImage: () => {},
  setImageStatus: () => {},
})

function Avatar({
  className,
  size = 'default',
  ...props
}: ComponentProps<typeof AvatarPrimitive.Root> & {
  size?: 'default' | 'sm' | 'lg'
}) {
  const [hasImage, setHasImage] = useState(false)
  const [imageStatus, setImageStatus] = useState<AvatarImageStatus>('loading')
  const registerImage = useCallback(() => setHasImage(true), [])
  const context = useMemo<AvatarContextValue>(
    () => ({ hasImage, imageStatus, registerImage, setImageStatus }),
    [hasImage, imageStatus, registerImage],
  )
  return (
    <AvatarContext.Provider value={context}>
      <AvatarPrimitive.Root
        data-slot="avatar"
        data-size={size}
        className={cn(
          'group/avatar relative flex size-8 shrink-0 overflow-hidden rounded-full select-none after:absolute after:inset-0 after:z-20 after:rounded-full after:border after:border-border after:mix-blend-darken data-[size=lg]:size-10 data-[size=sm]:size-6 dark:after:mix-blend-lighten',
          className,
        )}
        {...props}
      />
    </AvatarContext.Provider>
  )
}

/**
 * Renders an avatar image via next/image for automatic resizing and WebP conversion.
 * Uses `fill` layout — the parent <Avatar> provides the dimensions via CSS.
 * `sizes` should reflect the rendered CSS size for best optimisation.
 */
function AvatarImage({
  className,
  sizes,
  alt = '',
  onLoad,
  onError,
  ...props
}: MakeOptional<ImageProps, 'alt'> & MakeRequired<ImageProps, 'sizes'>) {
  const { registerImage, setImageStatus } = useContext(AvatarContext)
  const [errored, setErrored] = useState(false)

  useEffect(registerImage, [registerImage])

  if (errored) return null

  return (
    <NextImage
      data-slot="avatar-image"
      fill
      sizes={sizes}
      alt={alt}
      className={cn('z-10 rounded-full object-cover', className)}
      onLoad={(e) => {
        setImageStatus('loaded')
        onLoad?.(e)
      }}
      onError={(e) => {
        setErrored(true)
        setImageStatus('error')
        onError?.(e)
      }}
      {...props}
    />
  )
}

function AvatarFallback({ className, ...props }: ComponentProps<typeof AvatarPrimitive.Fallback>) {
  const { hasImage, imageStatus } = useContext(AvatarContext)
  // See the context note above: once the photo is painted the initials must
  // leave the tree entirely — always mounted, they were announced alongside
  // the image's alt text.
  if (hasImage && imageStatus === 'loaded') return null
  return (
    <AvatarPrimitive.Fallback
      data-slot="avatar-fallback"
      className={cn(
        'absolute inset-0 z-0 flex size-full items-center justify-center rounded-full bg-muted text-sm text-muted-foreground group-data-[size=sm]/avatar:text-xs',
        className,
      )}
      {...props}
    />
  )
}

function AvatarBadge({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="avatar-badge"
      className={cn(
        'absolute end-0 bottom-0 z-10 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground bg-blend-color ring-2 ring-background select-none',
        'group-data-[size=sm]/avatar:size-2 group-data-[size=sm]/avatar:[&>svg]:hidden',
        'group-data-[size=default]/avatar:size-2.5 group-data-[size=default]/avatar:[&>svg]:size-2',
        'group-data-[size=lg]/avatar:size-3 group-data-[size=lg]/avatar:[&>svg]:size-2',
        className,
      )}
      {...props}
    />
  )
}

function AvatarGroup({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group"
      className={cn(
        'group/avatar-group flex -space-x-2 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:ring-background',
        className,
      )}
      {...props}
    />
  )
}

function AvatarGroupCount({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="avatar-group-count"
      className={cn(
        'relative flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-sm text-muted-foreground ring-2 ring-background group-has-data-[size=lg]/avatar-group:size-10 group-has-data-[size=sm]/avatar-group:size-6 [&>svg]:size-4 group-has-data-[size=lg]/avatar-group:[&>svg]:size-5 group-has-data-[size=sm]/avatar-group:[&>svg]:size-3',
        className,
      )}
      {...props}
    />
  )
}

export { Avatar, AvatarBadge, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage }
