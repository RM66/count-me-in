import type { Metadata } from 'next'
import { Figtree } from 'next/font/google'

import { cn } from '@/lib/utils'
import { Providers } from './providers'

import './globals.css'

const figtree = Figtree({ subsets: ['latin'], variable: '--font-sans' })

export const metadata: Metadata = {
  title: 'CountMeIn — online booking for group events',
  description:
    'Publish services with time slots and capacity; guests book on a public page. Simple online booking for group events.',
  icons: {
    icon: [{ url: '/logo.svg', type: 'image/svg+xml' }],
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
