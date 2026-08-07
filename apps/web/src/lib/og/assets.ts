import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Figtree is the site's UI font (see layout.tsx). We bundle the TTFs so the
// generated OG cards render with the exact same typeface as the site, instead
// of Satori's generic sans-serif fallback. Resolving relative to this module
// (via import.meta.url) keeps the path correct regardless of process.cwd()
// and lets Next's file tracing include these files in the deployment bundle.
// In test runtimes (vitest/happy-dom) import.meta.url is not a file: URL, so we
// fall back to a cwd-relative path — the module's known location under src/.
const moduleDir = (() => {
  try {
    return fileURLToPath(new URL('.', import.meta.url))
  } catch {
    return join(process.cwd(), 'src/lib/og')
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
  const [regular, bold] = await Promise.all([
    readFile(join(moduleDir, 'fonts/Figtree-Regular.ttf')),
    readFile(join(moduleDir, 'fonts/Figtree-Bold.ttf')),
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
