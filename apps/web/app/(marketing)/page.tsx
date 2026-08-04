import { Audiences } from '@/app/(marketing)/_components/audiences'
import { Cta } from '@/app/(marketing)/_components/cta'
import { Faq } from '@/app/(marketing)/_components/faq'
import { Features } from '@/app/(marketing)/_components/features'
import { Hero } from '@/app/(marketing)/_components/hero'
import { HowItWorks } from '@/app/(marketing)/_components/how-it-works'
import { Trust } from '@/app/(marketing)/_components/trust'

// Static marketing content — prerendered at build time.
export const dynamic = 'force-static'

const SITE_URL = 'https://countmein.group'

// JSON-LD structured data. Emitted server-side into the static HTML so search
// engines can render a rich result. Kept in sync with the FAQ copy in faq.tsx.
const structuredData = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'WebApplication',
      name: 'CountMeIn',
      url: SITE_URL,
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      description:
        'Publish services with time slots and capacity; guests book on a public page. Online booking for group classes, events, and outings.',
      offers: {
        '@type': 'Offer',
        price: '0',
        priceCurrency: 'USD',
      },
    },
    {
      '@type': 'FAQPage',
      mainEntity: [
        {
          '@type': 'Question',
          name: 'Is CountMeIn really free?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Yes — you can create your account, publish services, and take bookings for free. Set up your first bookable service in a few minutes.',
          },
        },
        {
          '@type': 'Question',
          name: 'Do my guests need to install an app or create an account?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Guests open your link, pick a slot, and confirm with their messenger login and a name. There is no separate app to download and no password to remember.',
          },
        },
        {
          '@type': 'Question',
          name: 'Does CountMeIn handle payments?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'Not yet. Prices are shown as text on your services so guests know the cost, but payment happens the way you already collect it. Booking is about reserving the seat.',
          },
        },
        {
          '@type': 'Question',
          name: 'Can a slot ever be overbooked?',
          acceptedAnswer: {
            '@type': 'Answer',
            text: 'No. Every slot has a seat count and bookings are claimed atomically, so once a class is full it stops accepting bookings.',
          },
        },
      ],
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
