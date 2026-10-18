import {
  effectiveContact,
  effectiveLocation,
  serviceId as serviceIdShape,
  slugShape,
} from '@repo/contracts'
import { ArrowLeft } from 'lucide-react'
import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { ServiceMetaBadges } from '@/app/(guest)/_components/service-meta-badges'
import { BookingFlow } from '@/app/(guest)/[orgSlug]/[serviceId]/_components/booking-flow'
import { serviceJsonLd } from '@/app/(guest)/[orgSlug]/[serviceId]/_components/service-json-ld'
import { SlotList } from '@/app/(guest)/[orgSlug]/[serviceId]/_components/slot-list'
import { ContactLink } from '@/components/contact-link'
import { JsonLd } from '@/components/json-ld'
import { LocationLink } from '@/components/location-link'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { pageMetadata } from '@/lib/seo'
import { getPublicServiceView } from '@/server/api-client'

/**
 * Resolve the `/{orgSlug}/{serviceId}` pair into an organizer and their service.
 *
 * Shared by the page and its metadata because both need the same two rows and
 * the same `404` rule: the service must belong to the organizer in the URL, or
 * one organizer's service would render under another's name.
 */
async function resolveService(orgSlug: string, serviceId: string) {
  // Anything can match the dynamic segments — a value that cannot be a
  // slug or a service id is a 404 without spending an API round-trip.
  if (!slugShape.safeParse(orgSlug).success || !serviceIdShape.safeParse(serviceId).success) {
    return null
  }
  const view = await getPublicServiceView(serviceId)
  if (!view) return null
  // The service must belong to the organizer in the URL, or one
  // organizer's service would render under another's name.
  if (view.organizer.slug.toLowerCase() !== orgSlug.toLowerCase()) return null
  return view
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string; serviceId: string }>
}): Promise<Metadata> {
  const { orgSlug, serviceId } = await params
  const [resolved, t] = await Promise.all([
    resolveService(orgSlug, serviceId),
    getTranslations('ServicePage'),
  ])

  if (!resolved) return { title: t('serviceNotFound') }

  return pageMetadata({
    title: `${resolved.service.title} — ${resolved.organizer.name}`,
    description: resolved.service.description ?? undefined,
    path: `/${orgSlug}/${serviceId}`,
  })
}

export default async function ServicePage({
  params,
}: {
  params: Promise<{ orgSlug: string; serviceId: string }>
}) {
  const { orgSlug, serviceId } = await params
  const [t, resolved] = await Promise.all([
    getTranslations('ServicePage'),
    resolveService(orgSlug, serviceId),
  ])
  if (!resolved) notFound()
  const { organizer, service, slots } = resolved

  // A service may override its organizer's location and contact; the fallback
  // rule lives in contracts because the worker and calendar links need it
  // too (docs/domain.md).
  const location = effectiveLocation(service, organizer)
  const contact = effectiveContact(service, organizer)

  return (
    <>
      <JsonLd data={serviceJsonLd({ organizer, service, slots, location })} />
      {/*
        One BookingFlow owns the single dialog instance: the row and
        footer buttons only select a session — N+1 dialogs used to mount a
        state machine each.
      */}
      <BookingFlow initialView={resolved}>
        <div className="flex flex-col gap-5">
          <Link
            href={`/${organizer.slug}`}
            className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-4" />
            {organizer.name}
          </Link>

          <div className="overflow-hidden rounded-xl border">
            {service.photoUrl ? (
              <Image
                src={service.photoUrl}
                alt={service.title}
                width={720}
                height={360}
                className="aspect-2/1 w-full object-cover"
                preload
              />
            ) : (
              <div
                aria-hidden
                className="aspect-2/1 w-full bg-linear-to-br from-primary/15 to-primary/5"
              />
            )}
          </div>

          <div className="flex flex-col gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-balance">{service.title}</h1>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
              <ServiceMetaBadges
                service={service}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground"
              />
              {location ? (
                <LocationLink
                  location={location}
                  className="flex items-center gap-1.5 hover:text-foreground"
                  iconClassName="size-4"
                />
              ) : null}
              {contact ? <ContactLink contact={contact} className="hover:text-foreground" /> : null}
            </div>
            {service.description ? (
              <p className="leading-relaxed text-muted-foreground text-pretty">
                {service.description}
              </p>
            ) : null}
            {service.options?.length ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {service.optionsSelectMode === 'single' ? t('chooseOne') : t('addOns')}
                </span>
                {service.options.map((opt) => (
                  <Badge key={opt} variant="outline" className="font-normal">
                    {opt}
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          <Separator />
        </div>

        {/*
          The slot list, empty state and sticky footer read the live
          query inside BookingFlow (ADR-025) — occupancy changes refetch
          it without a page reload.
        */}
        <SlotList />
      </BookingFlow>
    </>
  )
}
