import { ArrowLeftIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { BookingManage } from '@/app/(guest)/booking/[manageToken]/_components/booking-manage'
import { Button } from '@/components/ui/button'
import { getGuestBookingByToken } from '@/server/db/booking'

/**
 * A booking's management page is private to whoever holds the link, so it must
 * never reach a search index — the token in the URL is the credential.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default async function BookingManagePage({
  params,
}: {
  params: Promise<{ manageToken: string }>
}) {
  const { manageToken } = await params

  // The token is the whole authorization (ADR-002): it was delivered to the
  // guest's verified messenger account, so no session is checked. An unknown
  // token is a plain 404 — the page never hints that a token nearly matched.
  const booking = await getGuestBookingByToken(manageToken)
  if (!booking) notFound()

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 md:py-16">
      <Button variant="ghost" size="sm" asChild className="mb-6 -ml-2">
        <Link href={`/${booking.organizer.slug}`}>
          <ArrowLeftIcon data-icon="inline-start" />
          Back to {booking.organizer.name}
        </Link>
      </Button>
      {/*
        The booking arrives with its slot, service and organizer already joined,
        so the client component needs no lookups of its own.
      */}
      <BookingManage booking={booking} />
    </div>
  )
}
