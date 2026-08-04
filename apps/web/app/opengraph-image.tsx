import { ImageResponse } from 'next/og'

import { SITE_DOMAIN } from '@/lib/constants/site'
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

  // Brand gradient lifted from logo.svg (#2726CF → #6F23F7).
  const gradient = 'linear-gradient(135deg, #2726CF 0%, #6F23F7 100%)'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: 'white',
          padding: 96,
          fontFamily: 'Figtree',
        }}
      >
        {/* Logo mark — the SVG already contains the wordmark, so no extra text. */}
        <div style={{ display: 'flex', alignItems: 'center' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={logo} width={132} height={132} alt="" style={{ borderRadius: 30 }} />
        </div>

        {/* Headline */}
        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 960 }}>
          <div
            style={{
              fontSize: 82,
              fontWeight: 700,
              color: '#18181B',
              lineHeight: 1.05,
              letterSpacing: -1.5,
            }}
          >
            Online booking for group events
          </div>
          <div style={{ fontSize: 38, fontWeight: 400, color: '#71717A', marginTop: 28, lineHeight: 1.35 }}>
            Publish services with time slots and capacity. Guests book on a public page — no account, no app.
          </div>
        </div>

        {/* Footer: gradient accent + domain */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
          <div style={{ display: 'flex', height: 14, width: 180, borderRadius: 999, background: gradient }} />
          <span style={{ fontSize: 32, fontWeight: 700, color: '#5B21B6' }}>{SITE_DOMAIN}</span>
        </div>
      </div>
    ),
    { ...size, fonts },
  )
}
