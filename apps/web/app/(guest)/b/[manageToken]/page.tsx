import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeftIcon } from 'lucide-react'
import { BookingManage } from '@/app/(guest)/b/[manageToken]/_components/booking-manage'
import { Button } from '@/components/ui/button'
import { bookings, getSlot, getService, organizer } from '@/lib/mock-data'

export default async function BookingManagePage({
  params,
}: {
  params: Promise<{ manageToken: string }>
}) {
  const { manageToken } = await params
  const booking = bookings.find((b) => b.manageToken === manageToken)
  if (!booking) notFound()

  const slot = getSlot(booking.timeSlotId)
  const service = slot ? getService(slot.serviceId) : undefined
  if (!slot || !service) notFound()

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 md:py-16">
      <Button variant="ghost" size="sm" asChild className="mb-6 -ml-2">
        <Link href={`/${organizer.slug}`}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back to {organizer.name}
        </Link>
      </Button>
      <BookingManage booking={booking} slot={slot} service={service} organizer={organizer} />
    </div>
  )
}
