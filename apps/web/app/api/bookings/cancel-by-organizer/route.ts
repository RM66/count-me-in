import { cancelBookingByOrganizerInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { cancelOwnedBooking } from '@/lib/server/db/booking'
import { parseJsonBody, requireWritableOrganizer } from '@/lib/server/http'
import { bookingErrorResponse } from '../_error-response'

/**
 * POST /api/bookings/cancel-by-organizer — the organizer cancels a booking on
 * one of their own services from the cabinet.
 *
 * Sibling of `/api/bookings/cancel`, kept as a **separate route** because the
 * credential differs: that one is authorized by the guest's `manageToken` and
 * takes no session, this one by the organizer's session plus ownership of the
 * service the booking hangs off. Folding both into one handler would mean a body
 * that accepts either secret, and an endpoint that cancels on whichever it finds
 * — the kind of branch where a missing check turns into cancelling someone
 * else's booking.
 *
 * `requireWritableOrganizer()` also refuses the demo account and anonymous
 * cabinet visitors, since `/cabinet` needs no session (ADR-010) — a route under
 * it does not imply an authenticated organizer.
 *
 * `POST` rather than `DELETE`: the booking is not removed, it moves to
 * `cancelled` and releases its seats (invariant 1), and the response is the
 * updated record.
 */
export async function POST(request: Request) {
  const guard = await requireWritableOrganizer()
  if (!guard.ok) return guard.response
  const { organizerId } = guard.value

  const parsed = await parseJsonBody(request, cancelBookingByOrganizerInput)
  if (!parsed.ok) return parsed.response

  try {
    const booking = await cancelOwnedBooking(organizerId, parsed.value.bookingId)

    // Unknown id and a booking on someone else's service are answered
    // identically, so the endpoint cannot be used to probe for foreign ids.
    if (!booking) {
      return NextResponse.json({ error: 'Booking not found' }, { status: 404 })
    }

    return NextResponse.json({ booking })
  } catch (error) {
    // Already cancelled → `409`, demo → `403`.
    const response = bookingErrorResponse(error)
    if (response) return response
    throw error
  }
}
