'use client'

import '@uiw/react-markdown-preview/markdown.css'
import { useTheme } from 'next-themes'
import dynamic from 'next/dynamic'
import { useEffect, useState, type ComponentProps } from 'react'

import { cn } from '@/lib/utils'

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
    <div data-color-mode={colorMode} className={cn(className)}>
      <MarkdownPreviewImpl {...props} style={{ backgroundColor: 'transparent', ...style }} />
    </div>
  )
}
