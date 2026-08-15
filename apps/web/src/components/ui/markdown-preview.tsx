import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import { cn } from '@/lib/utils'

/**
 * Server-rendered markdown.
 *
 * Deliberately *not* a client component: `react-markdown` is a pure transform
 * (mdast → hast → React elements) with no hooks and no browser APIs, so it runs
 * in an RSC and the rendered block ships inside the server HTML. The previous
 * implementation wrapped `@uiw/react-markdown-preview` in `dynamic({ ssr: false })`,
 * which meant the server sent a skeleton and the real text only appeared after
 * the chunk loaded — a visible reflow on a page that is otherwise fully static.
 *
 * That also removes the `next-themes` + `mounted` dance the old version needed:
 * the @uiw stylesheet themes itself off `data-color-mode`, which is unknowable on
 * the server, whereas the classes below resolve through our own design tokens and
 * flip with the `.dark` class like the rest of the app.
 *
 * Raw HTML is left unhandled on purpose. `react-markdown` drops it by default,
 * and `description` is organizer-authored text rendered on a public page, so
 * there is nothing to gain from `rehype-raw` and an XSS sink to lose.
 */

/**
 * How an organizer's bio is presented wherever it is shown.
 *
 * Exported so the settings editor's preview pane and the public page cannot
 * drift: the muted colour and `text-pretty` wrapping are part of what the
 * organizer is previewing, so a pane that rendered the same markdown at full
 * contrast would still be showing them something other than what ships.
 */
export const MARKDOWN_CLASS = 'text-left leading-relaxed text-muted-foreground text-pretty'

export function MarkdownPreview({ source, className }: { source: string; className?: string }) {
  return (
    <div
      className={cn(
        'text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
        // Block spacing — the markdown owns its own rhythm, since a paragraph
        // coming from user text cannot rely on a parent flex `gap`.
        '[&_p]:my-2 [&_p]:leading-relaxed',
        '[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5',
        '[&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5',
        '[&_li]:my-0.5',
        // Headings stay close to body size: this renders inside a card/profile
        // block, not as an article, so an `h1` must not out-shout the page title.
        '[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-base [&_h1]:font-semibold',
        '[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-sm [&_h2]:font-semibold',
        '[&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:text-sm [&_h3]:font-medium',
        '[&_strong]:font-semibold [&_em]:italic',
        '[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4 hover:[&_a]:text-foreground',
        '[&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:pl-3 [&_blockquote]:italic',
        '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs',
        '[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted [&_pre]:p-3',
        '[&_pre_code]:bg-transparent [&_pre_code]:p-0',
        '[&_hr]:my-3 [&_hr]:border-t',
        '[&_table]:my-2 [&_table]:w-full [&_table]:text-left',
        '[&_th]:border-b [&_th]:py-1 [&_th]:font-medium [&_td]:py-1',
        // Long URLs in user text must not widen the page on a phone.
        'wrap-break-word',
        className,
      )}
    >
      {/*
        GFM only — tables, strikethrough and autolinks are what an organizer
        actually types. No syntax highlighting: it would pull a highlighter
        (and its language grammars) into the server bundle to colour a code
        block that a booking page has no reason to contain.
      */}
      <Markdown remarkPlugins={[remarkGfm]}>{source}</Markdown>
    </div>
  )
}
