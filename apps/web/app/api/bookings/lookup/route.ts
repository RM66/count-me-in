import { lookupBookingsInput } from '@repo/api-contracts'
import { NextResponse } from 'next/server'

import { listGuestBookings } from '@/lib/server/db/booking'
import { parseJsonBody, requireGuestIdentity } from '@/lib/server/http'

/**
 * POST /api/bookings/lookup — "find my bookings" (ADR-002, entry path 2).
 *
 * The fallback for a guest who lost the deep link: they re-authenticate with the
 * widget and get every booking of that messenger identity, each carrying its own
 * `manageToken` so the list can link straight to the management page.
 *
 * `POST` despite being a read, for two reasons: the ticket is a secret that must
 * not land in a URL, and redeeming it *mutates* server state (it is single-use).
 * A cacheable `GET` carrying a one-shot credential would be wrong on both counts.
 *
 * The identity comes only from the ticket — accepting a `messengerId` from the
 * body would turn this endpoint into a way to read anyone's bookings.
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, lookupBookingsInput)
  if (!parsed.ok) return parsed.response

  const identity = await requireGuestIdentity(parsed.value.guestTicket)
  if (!identity.ok) return identity.response

  const { messenger, messengerId } = identity.value

  return NextResponse.json({ bookings: await listGuestBookings(messenger, messengerId) })
}
