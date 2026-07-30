'use client'

import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { type ComponentProps, type CSSProperties, useEffect, useState } from 'react'

import { cn } from '@/utils'

import '@uiw/react-markdown-editor/markdown-editor.css'

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
        'overflow-hidden rounded-2xl border',
        '[&_.md-editor]:bg-background!',
        '[&_.cm-editor]:bg-input/50!',
        '[&_.cm-gutters]:bg-transparent!',
        '[&_.cm-activeLine]:bg-transparent!',
        // CodeMirror defaults to a monospace font; make the editor text match the
        // rest of the app (sans font, base size, foreground color).
        '[&_.cm-editor_.cm-scroller]:font-sans!',
        '[&_.cm-editor_.cm-content]:text-sm! [&_.cm-editor_.cm-content]:text-foreground!',
        '[&_.cm-editor_.cm-gutters]:font-sans! [&_.cm-editor_.cm-gutters]:text-muted-foreground!',
        // The live-preview pane renders with `.wmde-markdown` and keeps the library's
        // built-in typography; align it with the app text style too.
        '[&_.wmde-markdown]:bg-transparent! [&_.wmde-markdown]:font-sans!',
        '[&_.wmde-markdown]:text-sm! [&_.wmde-markdown]:text-foreground!',
        className,
      )}
    >
      <MarkdownEditorImpl toolbars={TOOLBARS} {...props} />
    </div>
  )
}
