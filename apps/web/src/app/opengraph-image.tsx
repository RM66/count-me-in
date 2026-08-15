import { ImageResponse } from 'next/og'

import { loadFigtreeFonts, loadLogoDataUri } from '@/lib/og/assets'

// Route segment config — the size doubles as the emitted og:image dimensions
// and matches the 1.91:1 social card ratio.
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'CountMeIn — online booking for group events'

/**
 * Default social card for the whole site. Generated with next/og so it uses
 * the real logo.svg mark and the site's Figtree typeface — keeping the shared
 * link visually consistent with the product itself.
 */
export default async function OpengraphImage() {
  const [fonts, logo] = await Promise.all([loadFigtreeFonts(), loadLogoDataUri()])

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        background: 'white',
        padding: 96,
        fontFamily: 'Figtree',
      }}
    >
      {/* Logo mark — centered, 2× the original size. */}
      <img src={logo} width={264} height={264} alt="" style={{ borderRadius: 60 }} />

      {/* Tagline */}
      <div
        style={{
          fontSize: 40,
          fontWeight: 400,
          color: '#71717A',
          marginTop: 48,
          lineHeight: 1.35,
          textAlign: 'center',
          maxWidth: 900,
        }}
      >
        Simple online booking for group classes, events, and outings.
      </div>
    </div>,
    { ...size, fonts },
  )
}
