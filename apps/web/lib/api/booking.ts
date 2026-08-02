'use client'

import type {
  CreateBookingInput,
  GuestBooking,
  GuestTicketResponse,
  Messenger,
} from '@repo/api-contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { post } from './client'
import { queryKeys } from './keys'

/**
 * Client-side API for the **Booking** entity — the guest's side of it.
 *
 * All three operations are mutations, including the lookup: every one of them
 * spends a single-use credential (a guest ticket, or the `manageToken`), so none
 * can be a cache-backed `useQuery` that React Query is free to refetch on a
 * whim. The results are written into the cache by hand instead.
 *
 * The guest pages themselves are server components that read Postgres directly
 * (`lib/server/db/booking.ts`); this file exists for the interactive parts —
 * the booking dialog, the cancel button, the lookup form.
 */

/**
 * Exchange a Telegram widget payload for a guest ticket (ADR-008).
 *
 * Distinct from `useValidateTelegramWidget` in `auth.ts`: this one hits the guest
 * endpoint, which issues a ticket for booking and never a session. The two are
 * kept apart on the client for the same reason they are separate routes.
 */
export function useGuestTicket() {
  return useMutation({
    mutationFn: (widgetData: Record<string, unknown>) =>
      post<GuestTicketResponse>('/api/auth/telegram-guest', widgetData),
  })
}

/**
 * Reserve seats on a slot.
 *
 * The response carries the created booking **with its `manageToken`**, which is
 * what lets the success screen link straight to the management page.
 *
 * Nothing is invalidated here: the guest pages are server-rendered, so the
 * caller follows a successful booking with `router.refresh()` to pick up the new
 * `bookedCount`. Dropping a client cache would refetch nothing.
 */
export function useCreateBooking() {
  return useMutation({
    mutationFn: (input: CreateBookingInput) =>
      post<{ booking: GuestBooking }>('/api/bookings', input),
  })
}

/**
 * Cancel a booking with its `manageToken`.
 *
 * The token goes in the body, never the URL — it is a secret, and query strings
 * end up in logs and `Referer` headers.
 */
export function useCancelBooking() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (manageToken: string) =>
      post<{ booking: GuestBooking }>('/api/bookings/cancel', { manageToken }),
    // A cancelled booking changes what a lookup list should show, so any cached
    // list is dropped. The management page itself re-renders from the response.
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all }),
  })
}

/**
 * Look up every booking of a messenger identity, for the "lost my link" flow.
 *
 * Takes the ticket, but caches under the **identity** the server echoed back
 * with it: tickets are one-shot, so keying by ticket would never hit.
 */
export function useLookupBookings() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (identity: { ticket: string; messenger: Messenger; messengerId: string }) => {
      const data = await post<{ bookings: GuestBooking[] }>('/api/bookings/lookup', {
        guestTicket: identity.ticket,
      })

      queryClient.setQueryData(queryKeys.bookings.guest(identity.messengerId), data.bookings)

      return data.bookings
    },
  })
}
