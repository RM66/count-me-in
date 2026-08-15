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
