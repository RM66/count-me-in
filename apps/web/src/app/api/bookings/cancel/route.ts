import { cancelBookingByTokenInput } from '@repo/contracts'
import { after, NextResponse } from 'next/server'
import { getTranslations } from 'next-intl/server'

import { cancelGuestBookingByToken } from '@/server/db/booking'
import { parseJsonBody } from '@/server/http'
import { publishBookingCancelled } from '@/server/queue'
import { bookingErrorResponse } from '../_error-response'

/**
 * POST /api/bookings/cancel — the guest cancels via their `manageToken`
 * (ADR-002, cancel is in MVP).
 *
 * The token is the credential: it reached the guest through their verified
 * messenger account, so possession is proof of ownership and no session is
 * involved. It travels in the **body rather than the URL** so it stays out of
 * access logs, `Referer` headers and browser history — the same secret in a
 * query string would leak to every third party the page talks to.
 *
 * `POST` rather than `DELETE`: cancelling does not remove the booking, it moves
 * it to `cancelled` and releases the seats (invariant 1), and the response is
 * the updated booking the page re-renders from.
 */
export async function POST(request: Request) {
  const t = await getTranslations('ApiErrors')
  const parsed = await parseJsonBody(request, cancelBookingByTokenInput)
  if (!parsed.ok) return parsed.response

  try {
    const booking = await cancelGuestBookingByToken(parsed.value.manageToken)

    // Unknown token — answered exactly like a wrong one, so the endpoint cannot
    // be used to test whether a token exists.
    if (!booking) {
      return NextResponse.json({ error: t('bookingNotFound') }, { status: 404 })
    }

    // After-commit notification (ADR-012): the organizer is told by QStash
    // delivery once the cancellation is durable; the publisher never throws.
    after(() => publishBookingCancelled(booking.id, 'guest'))

    return NextResponse.json({ booking })
  } catch (error) {
    const response = bookingErrorResponse(error, t)
    if (response) return response
    throw error
  }
}
