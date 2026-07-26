import { Clock, MapPin } from 'lucide-react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { ServiceCard } from '@/app/(guest)/[orgSlug]/_components/service-card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { MarkdownPreview } from '@/components/ui/markdown-preview'
import { Separator } from '@/components/ui/separator'
import { organizer, services } from '@/lib/mock-data'

export const metadata: Metadata = {
  title: `${organizer.name} — book online`,
  description: organizer.description,
}

export default async function OrganizerPage({ params }: { params: Promise<{ orgSlug: string }> }) {
  const { orgSlug } = await params

  // Demo: only the seeded organizer exists.
  if (orgSlug !== organizer.slug) notFound()

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
          <p className="flex items-center justify-center gap-1 text-sm text-muted-foreground">
            <Clock className="size-3.5" />
            {organizer.timezone.replace('_', ' ')}
          </p>
        </div>
        <MarkdownPreview
          source={organizer.description}
          className="max-w-lg text-left text-sm leading-relaxed text-pretty"
        />
      </div>

      <Separator />

      <div className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-medium">Services</h2>
          <span className="text-sm text-muted-foreground">{services.length} available</span>
        </div>
        <div className="flex flex-col gap-3">
          {services.map((service) => (
            <ServiceCard key={service.id} orgSlug={orgSlug} service={service} />
          ))}
        </div>
      </div>
    </div>
  )
}
