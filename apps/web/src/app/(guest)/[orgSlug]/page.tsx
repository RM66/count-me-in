import { seatsLeft, slugShape } from '@repo/contracts'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'

import { ServiceCard } from '@/app/(guest)/[orgSlug]/_components/service-card'
import { ContactLink } from '@/components/contact-link'
import { JsonLd } from '@/components/json-ld'
import { LocationLink } from '@/components/location-link'
import { MARKDOWN_CLASS, MarkdownPreview } from '@/components/markdown/markdown-preview'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Separator } from '@/components/ui/separator'
import { SITE_URL } from '@/constants/site'
import { initials } from '@/helpers/name'
import { pageMetadata } from '@/lib/seo'
import { getPublicOrganizerView } from '@/server/api-client'

/**
 * Metadata has to be a function, not a static object: the title names the
 * organizer, and that is only known once the slug has been resolved against the
 * database. Next dedupes the render and the metadata pass, so the lookup here
 * does not double the queries.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string }>
}): Promise<Metadata> {
  const { orgSlug } = await params
  // Anything can match [orgSlug] — /favicon.ico, /wp-login.php. A value that
  // cannot be a slug is a 404 without spending an API round-trip.
  const [view, t] = await Promise.all([
    slugShape.safeParse(orgSlug).success ? getPublicOrganizerView(orgSlug) : null,
    getTranslations('OrgPage'),
  ])
  const organizer = view?.organizer ?? null

  if (!organizer) {
    // The page itself answers `404`; the metadata only has to avoid claiming a
    // name it does not have.
    return { title: t('pageNotFound') }
  }

  return pageMetadata({
    title: t('metaTitle', { name: organizer.name }),
    description: organizer.description ?? undefined,
    path: `/${organizer.slug}`,
  })
}

export default async function OrganizerPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params
  if (!slugShape.safeParse(orgSlug).success) notFound()
  // The slug is the only identifier a guest has — one API call returns the
  // organizer, their services, and every service's upcoming slots, so each
  // card can show its next open session without a lookup per card.
  const [t, locale, view] = await Promise.all([
    getTranslations('OrgPage'),
    getLocale(),
    getPublicOrganizerView(orgSlug),
  ])
  if (!view) notFound()
  const { organizer, services, slots } = view

  // Grouped once here rather than filtered inside each card — the cards receive
  // exactly their own slots and stay free of the parent's data shape.
  const slotsByService = new Map<string, typeof slots>()
  for (const slot of slots) {
    const bucket = slotsByService.get(slot.serviceId)
    if (bucket) bucket.push(slot)
    else slotsByService.set(slot.serviceId, [slot])
  }

  // A service with no seats left anywhere is still listed, but the count
  // advertises what a guest can actually act on.
  const bookableCount = services.filter((service) =>
    (slotsByService.get(service.id) ?? []).some((slot) => seatsLeft(slot) > 0),
  ).length

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: organizer.name,
        url: `${SITE_URL}/${organizer.slug}`,
        ...(organizer.description ? { description: organizer.description } : {}),
        ...(organizer.photoUrl ? { logo: organizer.photoUrl } : {}),
      },
      {
        '@type': 'ItemList',
        itemListElement: services.map((service, index) => ({
          '@type': 'ListItem',
          position: index + 1,
          name: service.title,
          url: `${SITE_URL}/${organizer.slug}/${service.id}`,
        })),
      },
    ],
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Structured data built from the same public rows the page renders;
          escaped for HTML context. */}
      <JsonLd data={structuredData} />
      <div className="flex flex-col items-center gap-4 text-center">
        <Avatar className="size-20">
          {organizer.photoUrl ? (
            <AvatarImage src={organizer.photoUrl} sizes="5rem" alt={organizer.name} />
          ) : null}
          <AvatarFallback>{initials(organizer.name)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{organizer.name}</h1>
          {organizer.location ? (
            <LocationLink
              location={organizer.location}
              className="flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              iconClassName="size-3.5"
            />
          ) : null}
          {/*
            Rendered through `ContactLink` so a phone becomes `tel:` and an email
            `mailto:` — the column is one free-text string and the link kind is
            decided at render time (docs/domain.md).
          */}
          {organizer.contact ? (
            <ContactLink
              contact={organizer.contact}
              className="text-sm text-muted-foreground hover:text-foreground"
            />
          ) : null}
        </div>
        {/*
          The presentation is shared with the settings editor's preview pane
          (`MARKDOWN_CLASS`) so what an organizer previews is what ships.
        */}
        {organizer.description ? (
          <MarkdownPreview source={organizer.description} className={MARKDOWN_CLASS} />
        ) : null}
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">{t('services')}</h2>
          <span className="text-sm text-muted-foreground">
            {t('available', { count: bookableCount })}
          </span>
        </div>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('nothingToBook')}</p>
        ) : (
          <div className="flex flex-col gap-3">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                orgSlug={organizer.slug}
                service={service}
                slots={slotsByService.get(service.id) ?? []}
                timezone={organizer.timezone}
                locale={locale}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
