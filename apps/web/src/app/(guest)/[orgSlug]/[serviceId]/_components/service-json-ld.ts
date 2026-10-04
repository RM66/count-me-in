import type { PublicOrganizer, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { seatsLeft } from '@repo/contracts'

import { SITE_URL } from '@/constants/site'

/**
 * The service page's JSON-LD graph: a BreadcrumbList plus one `Event` per
 * upcoming slot (date, availability) so search engines can surface open
 * sessions as rich results. Prices are display text, not amounts
 * (docs/domain.md) — deliberately absent from the offers.
 */
export function serviceJsonLd({
  organizer,
  service,
  slots,
  location,
}: {
  organizer: PublicOrganizer
  service: ServiceRecord
  slots: TimeSlotRecord[]
  /** The effective location — service overrides organizer (docs/domain.md). */
  location?: string
}) {
  const serviceUrl = `${SITE_URL}/${organizer.slug}/${service.id}`
  const organizerUrl = `${SITE_URL}/${organizer.slug}`
  const isOpen = (slot: TimeSlotRecord) => seatsLeft(slot) > 0

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: organizer.name, item: organizerUrl },
          { '@type': 'ListItem', position: 2, name: service.title, item: serviceUrl },
        ],
      },
      ...slots.map((slot) => ({
        '@type': 'Event',
        name: service.title,
        ...(service.description ? { description: service.description } : {}),
        startDate: slot.startsAt,
        eventStatus: isOpen(slot)
          ? 'https://schema.org/EventScheduled'
          : 'https://schema.org/EventSoldOut',
        ...(location ? { location: { '@type': 'Place', name: location } } : {}),
        organizer: { '@type': 'Organization', name: organizer.name, url: organizerUrl },
        offers: {
          '@type': 'Offer',
          url: serviceUrl,
          availability: isOpen(slot) ? 'https://schema.org/InStock' : 'https://schema.org/SoldOut',
        },
      })),
    ],
  }
}
