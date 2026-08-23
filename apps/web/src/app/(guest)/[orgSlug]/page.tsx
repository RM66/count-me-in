import { seatsLeft } from '@repo/contracts'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'

import { ServiceCard } from '@/app/(guest)/[orgSlug]/_components/service-card'
import { ContactLink } from '@/components/contact-link'
import { LocationLink } from '@/components/location-link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MARKDOWN_CLASS, MarkdownPreview } from '@/components/ui/markdown-preview'
import { Separator } from '@/components/ui/separator'
import { SITE_URL } from '@/constants/site'
import { pageMetadata } from '@/lib/seo'
import { getPublicOrganizerBySlug } from '@/server/db/organizer'
import { listServices } from '@/server/db/service'
import { listUpcomingSlotsForServices } from '@/server/db/time-slot'

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
  const organizer = await getPublicOrganizerBySlug(orgSlug)
  const t = await getTranslations('OrgPage')

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
  const t = await getTranslations('OrgPage')
  const locale = await getLocale()

  // The slug is the only identifier a guest has, so it is resolved first — every
  // read below is scoped to the organizer it returns.
  const organizer = await getPublicOrganizerBySlug(orgSlug)
  if (!organizer) notFound()

  const services = await listServices(organizer.id)

  // Every service's upcoming slots in one query, so each card can show its next
  // open session without a lookup per card. `listServices` is reused as-is: a
  // service row holds nothing an organizer would not print on their own page.
  const slots = await listUpcomingSlotsForServices(services.map((service) => service.id))

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
      <script
        type="application/ld+json"
        // Structured data built from the same public rows the page renders.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <div className="flex flex-col items-center gap-4 text-center">
        <Avatar className="size-20">
          {organizer.photoUrl ? (
            <AvatarImage src={organizer.photoUrl} sizes="5rem" alt={organizer.name} />
          ) : null}
          <AvatarFallback>{organizer.name.slice(0, 2)}</AvatarFallback>
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
