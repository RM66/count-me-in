import type { ReactNode } from 'react'

/**
 * Escapes JSON for safe embedding inside a `<script>` element.
 * `JSON.stringify` does not escape `<`,
 * `>`, `&` or the U+2028/U+2029 line separators, so organizer-controlled
 * text like `</script><script>…</script>` would break out of the tag —
 * a self-serve stored XSS on public pages. Escaping them as JSON unicode
 * escapes keeps the payload valid JSON and inert inside HTML.
 */
export function escapeJsonForHtml(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

type JsonLdProps = {
  /** The structured-data object; serialized and escaped by the component. */
  data: unknown
}

/**
 * Renders a `<script type="application/ld+json">` tag with the payload
 * escaped for HTML context. Use this for *any* JSON-LD built from
 * user-controlled fields — organizer names, service titles, descriptions.
 */
export function JsonLd({ data }: JsonLdProps): ReactNode {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: escapeJsonForHtml(JSON.stringify(data)) }}
    />
  )
}
