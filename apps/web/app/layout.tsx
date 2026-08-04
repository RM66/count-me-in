import type { Metadata } from 'next'
import { Figtree } from 'next/font/google'

import { SITE_URL } from '@/lib/constants/site'
import { cn } from '@/lib/utils'
import { Providers } from './providers'

import './globals.css'

const figtree = Figtree({ subsets: ['latin'], variable: '--font-sans' })

const TITLE = 'CountMeIn — online booking for group events'
const DESCRIPTION =
  'Publish services with time slots and capacity; guests book on a public page — no account, no app. Simple online booking for group classes, events, and outings.'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: '%s · CountMeIn',
  },
  description: DESCRIPTION,
  applicationName: 'CountMeIn',
  keywords: [
    'group booking',
    'event booking',
    'class booking',
    'online scheduling',
    'reservation',
    'capacity management',
  ],
  alternates: {
    canonical: '/',
  },
  icons: {
    icon: [{ url: '/logo.svg', type: 'image/svg+xml' }],
  },
  openGraph: {
    type: 'website',
    siteName: 'CountMeIn',
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: '/og-image.png',
        width: 1200,
        height: 630,
        alt: 'CountMeIn — online booking for group events',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: TITLE,
    description: DESCRIPTION,
    images: ['/og-image.png'],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning className="bg-background">
      <body className={cn('font-sans', 'antialiased', 'text-foreground', figtree.variable)}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
