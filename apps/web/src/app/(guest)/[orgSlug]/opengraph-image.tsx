import { ImageResponse } from 'next/og'

import { loadFigtreeFonts, loadLogoDataUri, loadRemoteImageDataUri } from '@/lib/og/assets'
import { getPublicOrganizerBySlug } from '@/server/db/organizer'

// Route segment config for the generated image. The size doubles as the
// og:image dimensions Next emits, so it matches the 1.91:1 card ratio.
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Book online'

/**
 * Per-organizer social card. Instead of inheriting the service's global
 * og-image, a shared link leads with the organizer's own photo, name and
 * location — the CountMeIn mark stays a small footer badge so the emphasis is
 * on them, not on the booking tool.
 */
export default async function OrganizerOgImage({
  params,
}: {
  // Next 16: params is a Promise in the image convention and must be awaited.
  params: Promise<{ orgSlug: string }>
}) {
  const { orgSlug } = await params
  const [organizer, fonts, logo] = await Promise.all([
    getPublicOrganizerBySlug(orgSlug),
    loadFigtreeFonts(),
    loadLogoDataUri(),
  ])

  // Satori cannot fetch remote URLs, so the R2-hosted photo is inlined as a
  // data URI (same approach as the logo). Falls back to `null` on failure so
  // the initials placeholder below still renders.
  const photoDataUri = organizer?.photoUrl ? await loadRemoteImageDataUri(organizer.photoUrl) : null

  // Brand gradient lifted from logo.svg (#2726CF → #6F23F7).
  const gradient = 'linear-gradient(135deg, #2726CF 0%, #6F23F7 100%)'

  if (!organizer) {
    return new ImageResponse(
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: gradient,
          color: 'white',
          fontSize: 64,
          fontWeight: 700,
          fontFamily: 'Figtree',
        }}
      >
        CountMeIn
      </div>,
      { ...size, fonts },
    )
  }

  const initials = organizer.name.slice(0, 2).toUpperCase()

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: 'white',
        padding: 80,
        fontFamily: 'Figtree',
      }}
    >
      {/* A thin brand bar keeps the service identity present but subordinate. */}
      <div
        style={{ display: 'flex', height: 12, width: 160, borderRadius: 999, background: gradient }}
      />

      <div style={{ display: 'flex', alignItems: 'center', gap: 48 }}>
        {photoDataUri ? (
          <img
            src={photoDataUri}
            width={220}
            height={220}
            alt=""
            style={{ borderRadius: 999, objectFit: 'cover', border: '6px solid #F1F0FB' }}
          />
        ) : (
          <div
            style={{
              width: 220,
              height: 220,
              borderRadius: 999,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: gradient,
              color: 'white',
              fontSize: 88,
              fontWeight: 700,
            }}
          >
            {initials}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', maxWidth: 720 }}>
          <div
            style={{
              fontSize: 68,
              fontWeight: 700,
              color: '#18181B',
              lineHeight: 1.1,
              // Long names must not overflow the card; clamp to two lines.
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 2,
              overflow: 'hidden',
            }}
          >
            {organizer.name}
          </div>
          {organizer.location ? (
            <div style={{ fontSize: 34, color: '#71717A', marginTop: 16 }}>
              {organizer.location}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 30 }}>
        <img src={logo} width={44} height={44} alt="" style={{ borderRadius: 12 }} />
        <span style={{ color: '#52525B' }}>Book online</span>
      </div>
    </div>,
    { ...size, fonts },
  )
}
