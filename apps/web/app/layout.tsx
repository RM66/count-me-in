import type { Metadata } from 'next'
import './globals.css'
import { Providers } from './providers'
import { Figtree } from 'next/font/google'
import { cn } from '@/lib/utils'

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
    <html lang="en" suppressHydrationWarning>
      <body className={cn('font-sans', 'antialiased', figtree.variable)}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
