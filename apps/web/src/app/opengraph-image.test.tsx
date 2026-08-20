import { describe, expect, it, vi } from 'vitest'

import OpengraphImage from './opengraph-image'

// The OG route reads translated copy via next-intl's request config, which
// only exists inside a request scope. The test renders the image out of one,
// so the translator is stubbed with a key-passthrough — the assertions below
// care about a valid PNG, not the copy.
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

// PNG file signature — every valid PNG starts with these 8 bytes.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/**
 * Smoke test for the default site OG card.
 *
 * The route pulls fonts via `loadFigtreeFonts()` (a `readFile` from disk) and
 * the logo via `loadLogoDataUri()`. A broken asset path — the exact bug we
 * fixed in `lib/og/assets.ts` — makes `readFile` throw `ENOENT`, so the route
 * never returns a response. Asserting a valid PNG comes out catches that whole
 * class of failure deterministically, without flaky pixel comparisons.
 */
describe('opengraph-image (default site card)', () => {
  it('renders a valid PNG response', async () => {
    const response = await OpengraphImage()

    expect(response).toBeInstanceOf(Response)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')

    const buffer = Buffer.from(await response.arrayBuffer())

    // Non-empty body — an ENOENT on the font/logo path throws before we get
    // here, so reaching this assertion means the asset paths resolved.
    expect(buffer.length).toBeGreaterThan(0)

    // Valid PNG magic bytes confirm Satori actually rendered an image, not a
    // zero-byte or corrupt response.
    expect(buffer.subarray(0, 8)).toEqual(PNG_SIGNATURE)
  })
})
