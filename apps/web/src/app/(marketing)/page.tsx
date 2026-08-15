import { Audiences } from '@/app/(marketing)/_components/audiences'
import { Cta } from '@/app/(marketing)/_components/cta'
import { Faq, faqs } from '@/app/(marketing)/_components/faq'
import { Features } from '@/app/(marketing)/_components/features'
import { Hero } from '@/app/(marketing)/_components/hero'
import { HowItWorks } from '@/app/(marketing)/_components/how-it-works'
import { Trust } from '@/app/(marketing)/_components/trust'
import { SITE_DESCRIPTION, SITE_URL } from '@/constants/site'

// Static marketing content — prerendered at build time.
export const dynamic = 'force-static'

// JSON-LD structured data. Emitted server-side into the static HTML so search
// engines can render a rich result. The FAQ entries are generated from the same
// `faqs` array the visible section renders, so the two can never drift.
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

export default function Home() {
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
