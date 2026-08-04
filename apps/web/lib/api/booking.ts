'use client'

import type {
  BookingRecord,
  CreateBookingInput,
  GuestBooking,
  GuestTicketResponse,
  Messenger,
} from '@repo/api-contracts'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { post } from './client'
import { queryKeys } from './keys'

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
 * Exchange a Telegram widget payload for a guest ticket (ADR-008).
 * Distinct from `useValidateTelegramWidget` in `auth.ts`: this one hits the
 * guest endpoint, which issues a ticket for booking and never a session.
 */
export function useGuestTicket() {
  return useMutation({
    mutationFn: (widgetData: Record<string, unknown>) =>
      post<GuestTicketResponse>('/api/auth/telegram-guest', widgetData),
  })
}

/**
 * Reserve seats on a slot.
 * The response carries the created booking **with its `manageToken`**, which
 * lets the success screen link straight to the management page.
 * Nothing is invalidated here: the guest pages are server-rendered, so the
 * caller follows a successful booking with `router.refresh()`.
 */
export function useCreateBooking() {
  return useMutation({
    mutationFn: (input: CreateBookingInput) =>
      post<{ booking: GuestBooking }>('/api/bookings', input),
  })
}

/**
 * Cancel a booking with its `manageToken`.
 * The token goes in the body, never the URL — it is a secret, and query
 * strings end up in logs and `Referer` headers.
 */
export function useCancelBooking() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (manageToken: string) =>
      post<{ booking: GuestBooking }>('/api/bookings/cancel', { manageToken }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all }),
  })
}

/**
 * Cancel a booking from the **cabinet**, as the organizer who owns it.
 * Separate hook from {@link useCancelBooking} because it uses a different
 * credential (session + ownership) against a different endpoint, and resolves
 * to a `BookingRecord` (no `manageToken`).
 * Invalidating `bookings.all` is not enough on its own: the cabinet lists are
 * server-rendered, so the caller follows this with `router.refresh()`.
 */
export function useCancelBookingByOrganizer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (bookingId: string) =>
      post<{ booking: BookingRecord }>('/api/bookings/cancel-by-organizer', { bookingId }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.bookings.all }),
        queryClient.invalidateQueries({ queryKey: queryKeys.slots.all }),
      ])
    },
  })
}

/**
 * Look up every booking of a messenger identity, for the "lost my link" flow.
 * Takes the ticket, but caches under the **identity** the server echoed back:
 * tickets are one-shot, so keying by ticket would never hit.
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
