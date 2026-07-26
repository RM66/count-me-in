'use client'

import '@uiw/react-markdown-editor/markdown-editor.css'
import { useTheme } from 'next-themes'
import dynamic from 'next/dynamic'
import { useEffect, useState, type ComponentProps, type CSSProperties } from 'react'

import { cn } from '@/lib/utils'

// The editor relies on CodeMirror / browser APIs, so it must never render on the server.
const MarkdownEditorImpl = dynamic(
  () => import('@uiw/react-markdown-editor').then((mod) => mod.default),
  { ssr: false },
)

type MarkdownEditorProps = ComponentProps<typeof MarkdownEditorImpl> & {
  className?: string
}

const TOOLBARS: MarkdownEditorProps['toolbars'] = ['undo', 'redo', 'bold', 'italic', 'link']

// The @uiw editor derives its backgrounds from these GitHub-markdown CSS variables.
// Pointing them at our design token makes the whole editor use the app control color.
const CSS_VARS = {
  '--color-canvas-default': 'transparent',
  '--color-canvas-subtle': 'transparent',
} as CSSProperties

export function MarkdownEditor({ className, ...props }: MarkdownEditorProps) {
  const { resolvedTheme } = useTheme()
  // Avoid a hydration mismatch: only trust the resolved theme after mount.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const colorMode = mounted && resolvedTheme === 'dark' ? 'dark' : 'light'

  return (
    <div
      data-color-mode={colorMode}
      style={CSS_VARS}
      className={cn(
        'overflow-hidden rounded-2xl border bg-input/50',
        '[&_.md-editor]:bg-transparent!',
        '[&_.cm-editor]:bg-transparent!',
        '[&_.cm-gutters]:bg-transparent!',
        className,
      )}
    >
      <MarkdownEditorImpl toolbars={TOOLBARS} {...props} />
    </div>
  )
}
