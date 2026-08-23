import type { Metadata } from 'next'

import { SITE_NAME } from '@/constants/site'

type PageMetadataProps = {
  /**
   * Plain strings run through the root `%s · CountMeIn` template. Titles that
   * already carry the brand (legal pages, the landing default) pass
   * `{ absolute }` to skip it — otherwise the suffix would double up.
   */
  title: string | { absolute: string }
  description?: string
  /** Site-absolute path (`/some-page`) — resolved against `metadataBase`. */
  path: string
}

/**
 * Metadata for one indexable page.
 *
 * Next merges metadata per top-level field down the segment tree: a page that
 * omits `alternates` or `openGraph` inherits the root layout's value, which
 * would point every canonical at `/`. Each page declares its own; this helper
 * keeps those declarations (and the OG/Twitter mirror of title/description)
 * uniform. The per-segment `opengraph-image.tsx` files keep supplying images —
 * a page-level `openGraph` without them would drop the card image.
 */
export function pageMetadata({ title, description, path }: PageMetadataProps): Metadata {
  const plainTitle = typeof title === 'string' ? title : title.absolute

  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      url: path,
      title: plainTitle,
      description,
    },
    twitter: {
      card: 'summary_large_image',
      title: plainTitle,
      description,
    },
  }
}

