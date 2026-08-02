import { NextResponse } from 'next/server'

import {
  BookingAlreadyCancelledError,
  InvalidOptionSelectionError,
  SlotNotBookableError,
  SlotSoldOutError,
} from '@/lib/server/db/booking'
import { DemoReadOnlyError } from '@/lib/server/demo'

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
 * The status codes carry meaning:
 * - `403` demo account — correctly identified, action forbidden (ADR-010)
 * - `404` slot/service gone — nothing to book
 * - `409` sold out / already cancelled — well-formed request, conflicting state
 * - `400` invalid option selection — the payload itself is wrong
 */
export function bookingErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof DemoReadOnlyError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }
  if (error instanceof SlotNotBookableError) {
    return NextResponse.json({ error: error.message }, { status: 404 })
  }
  if (error instanceof SlotSoldOutError) {
    // `seatsLeft` travels with it so the dialog can say how many are actually
    // left rather than only that the attempt failed.
    return NextResponse.json({ error: error.message, seatsLeft: error.seatsLeft }, { status: 409 })
  }
  if (error instanceof BookingAlreadyCancelledError) {
    return NextResponse.json({ error: error.message }, { status: 409 })
  }
  if (error instanceof InvalidOptionSelectionError) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
  return null
}
