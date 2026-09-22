'use client'

import type { CreateBookingInput, Messenger } from '@repo/contracts'
import { bookingEnvelope, guestBookingEnvelope, guestBookingsEnvelope } from '@repo/contracts'
import { useMutation } from '@tanstack/react-query'

import { post } from './client'

/**
 * Client-side API for the **Booking** entity — both audiences of it.
 *
 * Every guest operation is a mutation, including the lookup: each spends a
 * single-use credential (a guest ticket, or the `manageToken`), so none can be
 * a cache-backed `useQuery` that React Query is free to refetch on a whim.
 * Results are written into the cache by hand instead.
 *
 * The pages themselves are server components that read Postgres directly
 * (`lib/server/db/booking.ts`); this file exists for the interactive parts.
 */

/**
 * Reserve seats on a slot. The response includes `manageToken` for the
 * success screen. `retry: false` — the booking spends a single-use guest
 * ticket, so a retry always hits a 401 that overwrites the real result.
 *
 * Idempotency (architecture review fix #9): there is no explicit
 * idempotency key. The single-use ticket prevents replay, and the
 * partial unique index (one active booking per guest per slot) prevents
 * a duplicate on a same-slot manual retry. The residual edge case is a
 * network timeout after commit but before the response — the user sees
 * a failure and may re-authenticate to book a *different* slot, which
 * succeeds. This is acceptable for MVP; a formal idempotency key (the
 * ticket itself) can be added if "response lost" recovery matters.
 */
export function useCreateBooking() {
  return useMutation({
    mutationFn: (input: CreateBookingInput) => post('/api/bookings', input, guestBookingEnvelope),
    retry: false,
  })
}

/**
 * Cancel a booking with its `manageToken`.
 * The token goes in the body, never the URL — it is a secret, and query
 * strings end up in logs and `Referer` headers.
 */
export function useCancelBooking() {
  return useMutation({
    mutationFn: (manageToken: string) =>
      post('/api/bookings/cancel', { manageToken }, guestBookingEnvelope),
    // Non-idempotent: a retried cancel of an already-cancelled booking
    // surfaces `alreadyCancelled` and overwrites the real result (review W-6).
    retry: false,
  })
}

/**
 * Cancel a booking from the **cabinet**, as the organizer who owns it.
 * Separate hook from {@link useCancelBooking} because it uses a different
 * credential (session + ownership) against a different endpoint, and resolves
 * to a `BookingRecord` (no `manageToken`).
 * The cabinet lists are server-rendered, so the caller follows this with
 * `router.refresh()` (Phase 2.3 — no client cache to invalidate).
 */
export function useCancelBookingByOrganizer() {
  return useMutation({
    mutationFn: (bookingId: string) =>
      post('/api/bookings/cancel-by-organizer', { bookingId }, bookingEnvelope),
    // Non-idempotent: same reason as useCancelBooking (review W-6).
    retry: false,
  })
}

/**
 * Look up all bookings for a messenger identity ("lost my link" flow).
 * Caches under the identity (not the ticket — tickets are one-shot).
 * `retry: false` — same reason as `useCreateBooking`.
 */
export function useLookupBookings() {
  return useMutation({
    mutationFn: async (identity: { ticket: string; messenger: Messenger; messengerId: string }) => {
      const data = await post(
        '/api/bookings/lookup',
        {
          guestTicket: identity.ticket,
        },
        guestBookingsEnvelope,
      )

      return data.bookings
    },
    retry: false,
  })
}
