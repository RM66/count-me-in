import { ImageResponse } from 'next/og'

import { loadFigtreeFonts, loadLogoDataUri, loadRemoteImageDataUri } from '@/lib/og/assets'
import { getPublicOrganizerBySlug } from '@/server/db/organizer'
import { getPublicService } from '@/server/db/service'

export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const alt = 'Book this service online'

/**
 * Per-service social card. A shared service link is the most common thing a
 * guest sees, so the card leads with the service photo and title and attributes
 * it to the organizer — the CountMeIn mark is only a small footer badge.
 */
export default async function ServiceOgImage({
  params,
}: {
  // Next 16: params is a Promise in the image convention and must be awaited.
  params: Promise<{ orgSlug: string; serviceId: string }>
}) {
  const { orgSlug, serviceId } = await params
  const gradient = 'linear-gradient(135deg, #2726CF 0%, #6F23F7 100%)'

  const [organizer, fonts, logo] = await Promise.all([
    getPublicOrganizerBySlug(orgSlug),
    loadFigtreeFonts(),
    loadLogoDataUri(),
  ])
  const service = organizer ? await getPublicService(organizer.id, serviceId) : null

  // Satori cannot fetch remote URLs, so R2-hosted photos are inlined as data
  // URIs (same approach as the logo). Each falls back to `null` on failure so
  // the gradient / initials placeholders below still render.
  const [servicePhotoDataUri, organizerPhotoDataUri] = await Promise.all([
    service?.photoUrl ? loadRemoteImageDataUri(service.photoUrl) : Promise.resolve(null),
    organizer?.photoUrl ? loadRemoteImageDataUri(organizer.photoUrl) : Promise.resolve(null),
  ])

  if (!organizer || !service) {
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

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        background: 'white',
        fontFamily: 'Figtree',
      }}
    >
      {/* Left: the photo carries the visual weight of the card. */}
      <div style={{ display: 'flex', width: 520, height: '100%', position: 'relative' }}>
        {servicePhotoDataUri ? (
          <img
            src={servicePhotoDataUri}
            width={520}
            height={630}
            alt=""
            style={{ width: 520, height: 630, objectFit: 'cover' }}
          />
        ) : (
          <div style={{ display: 'flex', width: 520, height: 630, background: gradient }} />
        )}
      </div>

      {/* Right: title + organizer attribution + brand footer. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          flex: 1,
          padding: 64,
        }}
      >
        <div
          style={{
            display: 'flex',
            height: 12,
            width: 140,
            borderRadius: 999,
            background: gradient,
          }}
        />

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 60,
              fontWeight: 700,
              color: '#18181B',
              lineHeight: 1.1,
              display: '-webkit-box',
              WebkitBoxOrient: 'vertical',
              WebkitLineClamp: 3,
              overflow: 'hidden',
            }}
          >
            {service.title}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20, marginTop: 28 }}>
            {organizerPhotoDataUri ? (
              <img
                src={organizerPhotoDataUri}
                width={64}
                height={64}
                alt=""
                style={{ borderRadius: 999, objectFit: 'cover' }}
              />
            ) : null}
            <div style={{ fontSize: 34, color: '#52525B' }}>{organizer.name}</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 28 }}>
          <img src={logo} width={40} height={40} alt="" style={{ borderRadius: 11 }} />
          <span style={{ color: '#52525B' }}>Book online</span>
        </div>
      </div>
    </div>,
    { ...size, fonts },
  )
}
