import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Figtree is the site's UI font (see layout.tsx); we bundle the TTFs so OG
// cards match the site typeface instead of Satori's generic fallback.
// Resolving per concrete file via `new URL('./…', import.meta.url)` keeps
// paths cwd-independent and lets Next trace them into the deployment bundle.
// We resolve files, not the '.' directory — Turbopack can't trace the latter
// and warns. In tests (vitest/happy-dom) import.meta.url isn't a file: URL,
// so each falls back to a cwd-relative path under src/.
const regularFontPath = (() => {
  try {
    return fileURLToPath(new URL('./fonts/Figtree-Regular.ttf', import.meta.url))
  } catch {
    return join(process.cwd(), 'src/lib/og/fonts/Figtree-Regular.ttf')
  }
})()
const boldFontPath = (() => {
  try {
    return fileURLToPath(new URL('./fonts/Figtree-Bold.ttf', import.meta.url))
  } catch {
    return join(process.cwd(), 'src/lib/og/fonts/Figtree-Bold.ttf')
  }
})()
const logoPath = (() => {
  try {
    return fileURLToPath(new URL('../../../public/logo.svg', import.meta.url))
  } catch {
    return join(process.cwd(), 'public/logo.svg')
  }
})()

export type OgFont = {
  name: string
  data: Buffer
  weight: 400 | 700
  style: 'normal'
}

let fontCache: OgFont[] | null = null

export async function loadFigtreeFonts(): Promise<OgFont[]> {
  if (fontCache) return fontCache
  const [regular, bold] = await Promise.all([readFile(regularFontPath), readFile(boldFontPath)])
  fontCache = [
    { name: 'Figtree', data: regular, weight: 400, style: 'normal' },
    { name: 'Figtree', data: bold, weight: 700, style: 'normal' },
  ]
  return fontCache
}

let logoCache: string | null = null

// logo.svg inlined as a data URI so Satori renders the real brand mark (the
// favicon file) rather than an approximation.
export async function loadLogoDataUri(): Promise<string> {
  if (logoCache) return logoCache
  const svg = await readFile(logoPath)
  logoCache = `data:image/svg+xml;base64,${svg.toString('base64')}`
  return logoCache
}

/**
 * Fetch a remote image (e.g. an R2-hosted avatar or service photo) and inline
 * it as a data URI so Satori can render it. Satori cannot fetch remote URLs
 * itself, so the landing card works only because the logo is inlined — this
 * brings the per-organizer / per-service cards to the same behaviour.
 *
 * Returns `null` when the fetch fails or the response is not an image, so the
 * caller can fall back to its initials / gradient placeholder instead of
 * throwing and breaking the whole OG route.
 */
export async function loadRemoteImageDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type')
    if (!contentType || !contentType.startsWith('image/')) return null
    const buffer = Buffer.from(await res.arrayBuffer())
    return `data:${contentType};base64,${buffer.toString('base64')}`
  } catch {
    return null
  }
}
