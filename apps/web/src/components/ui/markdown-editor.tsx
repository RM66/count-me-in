'use client'

import dynamic from 'next/dynamic'
import { useTheme } from 'next-themes'
import { type ComponentProps, type CSSProperties, useEffect, useState } from 'react'

import { MARKDOWN_CLASS, MarkdownPreview } from '@/components/ui/markdown-preview'
import { cn } from '@/lib/utils'

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

/**
 * Render the live-preview pane with *our* `MarkdownPreview` instead of the
 * library's built-in one.
 *
 * Without this the editor previews through `@uiw`'s `.wmde-markdown` GitHub
 * stylesheet while the public page renders through our own element styles, so
 * the two disagree on exactly the details an organizer is checking — list
 * indentation and bullet markers, heading scale, link colour. Two renderers
 * cannot be kept in agreement by adding more CSS overrides; the fix is to have
 * one renderer.
 *
 * `renderPreview` is the library's own escape hatch, and it receives
 * `previewProps` with `source` already set to the current editor value (the
 * editor assigns it on every change), so the pane stays live.
 */
const renderPreview: MarkdownEditorProps['renderPreview'] = ({ source }) => (
  <MarkdownPreview source={source ?? ''} className={cn(MARKDOWN_CLASS, 'px-3 py-2')} />
)

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
        // No `.wmde-markdown` overrides needed here: `renderPreview` above replaces
        // the library's preview pane with our own component, which already carries
        // the app's typography.
        className,
      )}
    >
      <MarkdownEditorImpl renderPreview={renderPreview} toolbars={TOOLBARS} {...props} />
    </div>
  )
}
