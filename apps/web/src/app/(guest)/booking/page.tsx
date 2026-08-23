import { getTranslations } from 'next-intl/server'

import { FindBooking } from '@/app/(guest)/booking/_components/find-booking'
import { pageMetadata } from '@/lib/seo'

export async function generateMetadata() {
  const t = await getTranslations('MyBookings')
  return pageMetadata({
    title: t('title'),
    description: t('subtitle'),
    path: '/booking',
  })
}

export default function FindBookingPage() {
  return <FindBooking />
}
