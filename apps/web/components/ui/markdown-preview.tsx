'use client'

import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { type ComponentProps, useEffect, useState } from 'react'

import { cn } from '@/lib/utils'

import '@uiw/react-markdown-preview/markdown.css'

const MarkdownPreviewImpl = dynamic(
  () => import('@uiw/react-markdown-preview').then((mod) => mod.default),
  { ssr: false },
)

type MarkdownPreviewProps = ComponentProps<typeof MarkdownPreviewImpl> & {
  className?: string
}

export function MarkdownPreview({ className, style, ...props }: MarkdownPreviewProps) {
  const { resolvedTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const colorMode = mounted && resolvedTheme === 'dark' ? 'dark' : 'light'

  return (
    <div
      data-color-mode={colorMode}
      className={cn(
        // The library ships its own font/size/color on `.wmde-markdown`; override it
        // so the rendered markdown inherits from this wrapper instead.
        '[&_.wmde-markdown]:bg-transparent! [&_.wmde-markdown]:font-[inherit]!',
        '[&_.wmde-markdown]:text-[length:inherit]! [&_.wmde-markdown]:leading-[inherit]!',
        '[&_.wmde-markdown]:text-inherit!',
        className,
      )}
    >
      <MarkdownPreviewImpl {...props} style={{ backgroundColor: 'transparent', ...style }} />
    </div>
  )
}
