import { NextResponse } from 'next/server'
import type { useTranslations } from 'next-intl'

import {
  BookingAlreadyCancelledError,
  DuplicateBookingError,
  InvalidOptionSelectionError,
  PartyTooLargeError,
  SlotNotBookableError,
  SlotSoldOutError,
} from '@/server/db/booking'
import { DemoReadOnlyError } from '@/server/demo'

import 'server-only'

/**
 * Booking failure modes → HTTP responses, for the handlers in this directory.
 *
 * Lives beside the routes rather than in `lib/server/http.ts` on purpose: that
 * module is request-level plumbing (sessions, tickets, body parsing) and must not
 * know about entities. Deciding that "sold out" is a `409` requires knowing what
 * a booking is, so it belongs to the layer that serves bookings — and an
 * `_`-prefixed file is excluded from routing, so it can sit here without becoming
 * a URL.
 *
 * Shared by the three booking routes rather than inlined in each: they throw
 * overlapping sets of these, and hand-rolling the mapping per handler is how the
 * same condition ends up a `409` on one route and a `500` on another. (Contrast
 * `/api/slots/[id]`, which maps its two errors inline — one handler, no risk of
 * disagreeing with itself.)
 *
 * Returns `null` for anything else, so an unexpected error keeps propagating and
 * surfaces as a `500` instead of being flattened into a misleading `4xx`.
 *
 * The `error` copy is localized (ADR-011): the error *classes* still carry
 * English `message`s for logs, but the response body is built from the caller's
 * `ApiErrors` translator — the request scope provides the locale, and the
 * machine-readable `code`/`seatsLeft`/`maxSeats` fields keep travelling for
 * clients that prefer their own copy.
 *
 * The status codes carry meaning:
 * - `403` demo account — correctly identified, action forbidden (ADR-010)
 * - `404` slot/service gone — nothing to book
 * - `409` sold out / already cancelled / duplicate booking — well-formed
 *   request, conflicting state
 * - `400` invalid option selection / party over the per-booking cap — the
 *   payload itself is wrong
 *
 */
export function bookingErrorResponse(
  error: unknown,
  t: ReturnType<typeof useTranslations<'ApiErrors'>>,
): NextResponse | null {
  if (error instanceof DemoReadOnlyError) {
    return NextResponse.json(
      { error: t('demoReadOnly'), code: error.code },
      { status: error.status },
    )
  }
  if (error instanceof SlotNotBookableError) {
    return NextResponse.json({ error: t('slotGone') }, { status: 404 })
  }
  if (error instanceof SlotSoldOutError) {
    // `seatsLeft` travels with it so the dialog can say how many are actually
    // left rather than only that the attempt failed.
    return NextResponse.json(
      {
        error:
          error.seatsLeft === 0
            ? t('soldOut')
            : t('seatsLeftOnSession', { count: error.seatsLeft }),
        seatsLeft: error.seatsLeft,
      },
      { status: 409 },
    )
  }
  if (error instanceof DuplicateBookingError) {
    return NextResponse.json({ error: t('duplicateBooking'), code: 'duplicate_booking' }, { status: 409 })
  }
  if (error instanceof BookingAlreadyCancelledError) {
    return NextResponse.json({ error: t('alreadyCancelled') }, { status: 409 })
  }
  if (error instanceof InvalidOptionSelectionError) {
    // The class message carries the English validation detail for logs; the
    // body gets the machine-readable `code` plus localized copy, and the
    // booking dialog re-renders it from the code (ADR-011).
    return NextResponse.json(
      { error: t('invalidOptions'), code: 'invalid_option' },
      { status: 400 },
    )
  }
  if (error instanceof PartyTooLargeError) {
    return NextResponse.json(
      { error: t('partyTooLarge', { maxSeats: error.maxSeats }), maxSeats: error.maxSeats },
      { status: 400 },
    )
  }
  return null
}
