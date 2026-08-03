import { seatsLeft } from '@repo/api-contracts'
import { MapPin } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ServiceCard } from '@/app/(guest)/[orgSlug]/_components/service-card'
import { ContactLink } from '@/components/contact-link'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MARKDOWN_CLASS, MarkdownPreview } from '@/components/ui/markdown-preview'
import { Separator } from '@/components/ui/separator'
import { getPublicOrganizerBySlug } from '@/lib/server/db/organizer'
import { listServices } from '@/lib/server/db/service'
import { listUpcomingSlotsForServices } from '@/lib/server/db/time-slot'

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

  if (!organizer) {
    // The page itself answers `404`; the metadata only has to avoid claiming a
    // name it does not have.
    return { title: 'Page not found' }
  }

  return {
    title: `${organizer.name} — book online`,
    description: organizer.description ?? undefined,
  }
}

export default async function OrganizerPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <Avatar className="size-20">
          <AvatarImage
            src={organizer.photoUrl || '/placeholder.svg'}
            sizes="5rem"
            alt={organizer.name}
          />
          <AvatarFallback>{organizer.name.slice(0, 2)}</AvatarFallback>
        </Avatar>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">{organizer.name}</h1>
          {organizer.location ? (
            <p className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
              <MapPin className="size-3.5" />
              {organizer.location}
            </p>
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
          <h2 className="text-lg font-medium">Services</h2>
          <span className="text-sm text-muted-foreground">{bookableCount} available</span>
        </div>
        {services.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to book just yet — check back soon.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {services.map((service) => (
              <ServiceCard
                key={service.id}
                orgSlug={organizer.slug}
                service={service}
                slots={slotsByService.get(service.id) ?? []}
                timezone={organizer.timezone}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
