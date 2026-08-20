import { createBookingInput } from '@repo/contracts'
import { NextResponse } from 'next/server'
import { getTranslations } from 'next-intl/server'

import { createGuestBooking } from '@/server/db/booking'
import { parseJsonBody, requireGuestIdentity } from '@/server/http'
import { bookingErrorResponse } from './_error-response'

/**
 * POST /api/bookings — a guest reserves seats (ADR-002).
 *
 * The public write of the whole product, and the only one with no session:
 * guests have no Auth.js account, so authorization is the short-lived ticket
 * from `/api/auth/telegram-guest`. That ticket is consumed here, which is what
 * makes a replayed request fail rather than double-book.
 *
 * Only `guestName`, the slot and the options come from the body; the identity
 * stored on the row is read from the ticket server-side (invariant 8). Seats are
 * claimed by the atomic reserve in `createGuestBooking` (invariant 2), so this
 * handler contains no capacity logic of its own — it maps the outcome onto a
 * status code and nothing more.
 */
export async function POST(request: Request) {
  const t = await getTranslations('ApiErrors')
  const parsed = await parseJsonBody(request, createBookingInput)
  if (!parsed.ok) return parsed.response
  const { guestTicket, ...booking } = parsed.value

  const identity = await requireGuestIdentity(guestTicket)
  if (!identity.ok) return identity.response

  try {
    const created = await createGuestBooking({
      serviceId: booking.serviceId,
      timeSlotId: booking.timeSlotId,
      seats: booking.seats,
      guestName: booking.guestName,
      selectedOptions: booking.selectedOptions,
      guestLocale: booking.guestLocale,
      guest: identity.value,
    })

    return NextResponse.json({ booking: created }, { status: 201 })
  } catch (error) {
    // Sold out, gone, demo, bad options — all already have a status code.
    const response = bookingErrorResponse(error, t)
    if (response) return response
    throw error
  }
}
