import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/constants/site'
import { listPublicOrganizerSlugs } from '@/server/db/organizer'
import { listPublicServicePaths } from '@/server/db/service'

// Dynamic rather than prerendered: a static sitemap would make every
// `next build` query Postgres, breaking builds without database access.
// Crawlers fetch it rarely, so two catalog reads per request are fine.
export const dynamic = 'force-dynamic'

/** `/demo` needs no separate entry: it is an ordinary `/{orgSlug}` page. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/terms`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: 'yearly', priority: 0.3 },
  ]

  const [organizers, services] = await Promise.all([
    listPublicOrganizerSlugs(),
    listPublicServicePaths(),
  ])

  const organizerPages: MetadataRoute.Sitemap = organizers.map(({ slug }) => ({
    url: `${SITE_URL}/${slug}`,
    changeFrequency: 'daily',
    priority: 0.8,
  }))

  const servicePages: MetadataRoute.Sitemap = services.map(({ orgSlug, serviceId }) => ({
    url: `${SITE_URL}/${orgSlug}/${serviceId}`,
    changeFrequency: 'daily',
    priority: 0.6,
  }))

  return [...staticPages, ...organizerPages, ...servicePages]
}
