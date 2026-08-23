import type { MetadataRoute } from 'next'

import { SITE_URL } from '@/constants/site'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        // Private surfaces: JSON API, the organizer cabinet (noindex meta too),
        // token-bearing booking management pages and one-time login links.
        disallow: ['/api/', '/cabinet/', '/booking/', '/login/link/'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
