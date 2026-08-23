import { getTranslations } from 'next-intl/server'

import { Audiences } from '@/app/(marketing)/_components/audiences'
import { Cta } from '@/app/(marketing)/_components/cta'
import { Faq } from '@/app/(marketing)/_components/faq'
import { Features } from '@/app/(marketing)/_components/features'
import { Hero } from '@/app/(marketing)/_components/hero'
import { HowItWorks } from '@/app/(marketing)/_components/how-it-works'
import { Trust } from '@/app/(marketing)/_components/trust'
import { SITE_DESCRIPTION, SITE_TITLE, SITE_URL } from '@/constants/site'
import { pageMetadata } from '@/lib/seo'

export const metadata = pageMetadata({
  title: { absolute: SITE_TITLE },
  description: SITE_DESCRIPTION,
  path: '/',
})

/**
 * JSON-LD structured data. Emitted server-side so search engines can render a
 * rich result. The FAQ entries are generated from the same translated FAQ
 * dictionary the visible section renders, so the two can never drift — and the
 * structured data follows the viewer's locale.
 */
export default async function Home() {
  const t = await getTranslations('Marketing')

  const faqs = t.raw('faq.items') as Array<{ q: string; a: string }>

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        name: 'CountMeIn',
        url: SITE_URL,
        logo: `${SITE_URL}/logo.svg`,
      },
      {
        '@type': 'WebApplication',
        name: 'CountMeIn',
        url: SITE_URL,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        description: SITE_DESCRIPTION,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      },
      {
        '@type': 'FAQPage',
        mainEntity: faqs.map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: {
            '@type': 'Answer',
            text: item.a,
          },
        })),
      },
    ],
  }

  return (
    <main className="flex-1">
      <script
        type="application/ld+json"
        // Structured data is trusted, static content defined in this file.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <Hero />
      <HowItWorks />
      <Audiences />
      <Features />
      <Trust />
      <Faq />
      <Cta />
    </main>
  )
}
