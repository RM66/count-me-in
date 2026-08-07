import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Figtree is the site's UI font (see layout.tsx). We bundle the TTFs so the
// generated OG cards render with the exact same typeface as the site, instead
// of Satori's generic sans-serif fallback. Reading via a literal path lets
// Next's file tracing include these files in the deployment bundle.
export type OgFont = {
  name: string
  data: Buffer
  weight: 400 | 700
  style: 'normal'
}

let fontCache: OgFont[] | null = null

export async function loadFigtreeFonts(): Promise<OgFont[]> {
  if (fontCache) return fontCache
  const [regular, bold] = await Promise.all([
    readFile(join(process.cwd(), 'lib/og/fonts/Figtree-Regular.ttf')),
    readFile(join(process.cwd(), 'lib/og/fonts/Figtree-Bold.ttf')),
  ])
  fontCache = [
    { name: 'Figtree', data: regular, weight: 400, style: 'normal' },
    { name: 'Figtree', data: bold, weight: 700, style: 'normal' },
  ]
  return fontCache
}

let logoCache: string | null = null

// The real app icon (logo.svg) inlined as a data URI so Satori can render the
// actual brand mark — the same file used for the favicon — rather than an
// approximation.
export async function loadLogoDataUri(): Promise<string> {
  if (logoCache) return logoCache
  const svg = await readFile(join(process.cwd(), 'public/logo.svg'))
  logoCache = `data:image/svg+xml;base64,${svg.toString('base64')}`
  return logoCache
}
