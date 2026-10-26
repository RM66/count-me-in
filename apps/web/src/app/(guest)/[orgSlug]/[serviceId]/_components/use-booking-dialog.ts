'use client'

import type {
  GuestBooking,
  GuestTicketResponse,
  ServiceRecord,
  TimeSlotRecord,
} from '@repo/contracts'
import { DEFAULT_LOCALE, isAppLocale, seatsLeft } from '@repo/contracts'
import { useQueryClient } from '@tanstack/react-query'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { queryKeys, useCreateBooking } from '@/api-client'
import { ApiError, errorMessage } from '@/api-client/error'

export type BookingStep = 'slot' | 'options' | 'details' | 'verify' | 'success'

type UseBookingDialogOptions = {
  service: ServiceRecord
  /** The bookable slots — the seat ceiling is clamped against the picked one. */
  slots?: TimeSlotRecord[]
  preselectedSlotId?: string
}

/**
 * The state machine behind the guest booking flow (docs/pages.md):
 * pick slot → options → name → Telegram → confirmation.
 *
 * Extracted from [`BookingDialog`](booking-dialog.tsx) so the component is left
 * with rendering only. The last two steps are one round trip each and in a
 * fixed order: the Telegram login proves the identity (`verify`), and only then does
 * `POST /api/bookings` claim the seats. Nothing is reserved before that — the
 * ticket holds no seat (docs/domain.md), so the sold-out case surfaces at the
 * moment of booking.
 */

/**
 * The server's error copy is English and fixed; the dialog re-renders the
 * failure modes it can recognize from status/code/details into the guest's
 * language, with the real numbers (`seatsLeft`, `maxSeats`) kept.
 */
function localizedError(t: ReturnType<typeof useTranslations<'Booking'>>, err: unknown): string {
  if (!(err instanceof ApiError)) {
    return errorMessage(err, t('errorFallback'))
  }

  if (err.code === 'duplicate_booking') return t('errDuplicate')
  if (err.code === 'invalid_option') return t('errInvalidOptions')

  const seatsLeft = typeof err.details?.seatsLeft === 'number' ? err.details.seatsLeft : undefined
  const maxSeats = typeof err.details?.maxSeats === 'number' ? err.details.maxSeats : undefined

  if (err.status === 409 && seatsLeft !== undefined) {
    return seatsLeft === 0 ? t('errSoldOut') : t('errSeatsLeft', { count: seatsLeft })
  }
  if (err.status === 400 && maxSeats !== undefined) {
    return t('errPartyTooLarge', { maxSeats })
  }
  if (err.status === 404) return t('errGone')

  return errorMessage(err, t('errorFallback'))
}

/**
 * The live-occupancy notice for the picked slot (ADR-025): `filled` —
 * it disappeared or reached zero seats left; `shrunk` — the party size
 * now exceeds what is left. Derived from the *live* slot list (the
 * SSE-patched query), suppressed while a booking attempt is in flight
 * or done — the 409 the server answers is already the honest verdict,
 * and a notice stacked on it would only flicker.
 */
export type OccupancyNotice = 'filled' | 'shrunk' | null

export function useBookingDialog({
  service,
  slots = [],
  preselectedSlotId,
}: UseBookingDialogOptions) {
  const queryClient = useQueryClient()
  const createBooking = useCreateBooking()
  const t = useTranslations('Booking')
  const locale = useLocale()

  const hasOptions = !!service.options?.length
  const [step, setStep] = useState<BookingStep>('slot')
  const [slotId, setSlotIdRaw] = useState<string | undefined>(preselectedSlotId)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [name, setName] = useState('')
  /** Party size, clamped to `seatCeiling` whenever the slot or submit moves. */
  const [seats, setSeats] = useState(1)
  /** The completed booking — the only source for the success screen. */
  const [booking, setBooking] = useState<GuestBooking | null>(null)
  /** A failed attempt, shown on the verify step (stays visible while picking another slot). */
  const [error, setError] = useState<string | null>(null)
  /** Whether `error` is a duplicate 409 — shows a "find my bookings" link instead of just the text. */
  const [isDuplicate, setIsDuplicate] = useState(false)
  /**
   * Whether the guest has tapped Telegram. Once true the button and instruction
   * stay hidden — the ticket is single-use, so a retry would always fail.
   * Cleared on `reset()`.
   */
  const [attempted, setAttempted] = useState(false)
  /**
   * Concurrent `handleTicket` calls in flight. The login flow can fire twice for
   * one tap; the first call gets the real result, the second gets a 401 (ticket
   * already consumed). A 401 with another call still in flight is dropped.
   * Cleared on `reset()`.
   */
  const inFlightCount = useRef(0)

  /**
   * The most a party may claim on a slot: the organizer's per-booking cap,
   * but never more than the seats actually left. Before a slot is picked the
   * service cap stands in — the details step is only reached with one.
   * The `Math.max(1, …)` floor keeps the stepper's upper bound sane on a
   * filled slot; the submit-side guards use the real `seatsLeft` below.
   */
  const seatCeiling = (slot: string | undefined) => {
    const picked = slot ? slots.find((s) => s.id === slot) : undefined
    return Math.max(
      1,
      picked ? Math.min(service.maxSeatsPerBooking, seatsLeft(picked)) : service.maxSeatsPerBooking,
    )
  }
  const maxSeats = seatCeiling(slotId)

  const clampSeats = (value: number, slot: string | undefined) =>
    Math.min(Math.max(1, value), seatCeiling(slot))

  // ── Live occupancy (ADR-025) ────────────────────────────────────────────
  // `slots` is the SSE-patched list — a slot can fill, shrink or vanish
  // mid-flow. Notices are derived, never stored: they cannot desync.
  const pickedSlot = slotId ? slots.find((s) => s.id === slotId) : undefined
  /** Real seats left on the picked slot — 0 when it filled or vanished. */
  const liveSeatsLeft = pickedSlot ? seatsLeft(pickedSlot) : 0
  /**
   * Suppression: from the Telegram tap (`attempted`) through the pending
   * POST and any 409 error, and on the success screen — the event that
   * arrives then is *our own* booking (or another guest's) and the
   * server response already reports the outcome. Cleared by any
   * deliberate navigation (back, re-pick, confirm-seats).
   */
  const liveSuppressed = attempted || step === 'success'
  const liveNotice: OccupancyNotice =
    !liveSuppressed && slotId
      ? pickedSlot === undefined || liveSeatsLeft === 0
        ? 'filled'
        : seats > liveSeatsLeft
          ? 'shrunk'
          : null
      : null

  /** Clear the attempt marks — any deliberate navigation lets notices resurface. */
  function clearAttempt() {
    setAttempted(false)
    setError(null)
    setIsDuplicate(false)
  }

  /** Pick a slot and re-clamp the party size against its remaining seats. */
  function setSlotId(next: string | undefined) {
    if (next !== slotId) {
      // A deliberate re-pick clears the previous attempt state.
      clearAttempt()
    }
    setSlotIdRaw(next)
    setSeats((prev) => clampSeats(prev, next))
  }

  /** `slotFilled`'s action: back to the picker with a clean slate. */
  function pickAnotherSlot() {
    setStep('slot')
    setSlotIdRaw(undefined)
    clearAttempt()
  }

  /** `seatsShrunk`'s confirm: take what is left, clear the attempt state. */
  function bookRemainingSeats() {
    setSeats(Math.max(1, liveSeatsLeft))
    clearAttempt()
  }

  /** Verify → details: clears the spent attempt so notices can resurface. */
  function backFromVerify() {
    setStep('details')
    clearAttempt()
  }

  function reset() {
    setStep('slot')
    setSlotIdRaw(preselectedSlotId)
    setSelectedOptions([])
    setName('')
    setSeats(1)
    setBooking(null)
    clearAttempt()
    inFlightCount.current = 0
  }

  function goFromSlot() {
    setStep(hasOptions ? 'options' : 'details')
  }

  function toggleOption(value: string) {
    if (service.optionsSelectMode === 'single') {
      setSelectedOptions([value])
    } else {
      setSelectedOptions((prev) =>
        prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value],
      )
    }
  }

  /**
   * Login auth succeeded — spend the ticket on the booking immediately.
   * Tickets are single-use, so holding one only risks expiry or losing the
   * last seat. See `inFlightCount` above for the double-fire defense.
   */
  async function handleTicket(ticket: GuestTicketResponse) {
    if (!slotId) return

    setError(null)
    setIsDuplicate(false)
    setAttempted(true)

    inFlightCount.current++
    try {
      // No last-second clamp: the step guards block a stale request, a
      // just-lost seat is the server's 409 — a silent shrink books the
      // wrong thing.
      const result = await createBooking.mutateAsync({
        serviceId: service.id,
        timeSlotId: slotId,
        seats,
        guestName: name.trim() || ticket.displayName,
        guestTicket: ticket.ticket,
        selectedOptions: selectedOptions.length > 0 ? selectedOptions : undefined,
        // The confirmation message is rendered in the language the guest is
        // reading right now (ADR-011).
        guestLocale: isAppLocale(locale) ? locale : DEFAULT_LOCALE,
      })

      setBooking(result.booking)
      setStep('success')
      // The slot list is a client query (ADR-025): RSC cannot overwrite
      // the seeded cache, so invalidate directly on booking completion
      // without waiting for the post-commit SSE signal.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.publicService.detail(service.id),
      })
    } catch (err) {
      // A 401 with another call in flight is the login double-fire — drop it.
      if (err instanceof ApiError && err.status === 401 && inFlightCount.current > 1) {
        return
      }
      setError(localizedError(t, err))
      setIsDuplicate(err instanceof ApiError && err.code === 'duplicate_booking')
      // A 409 means occupancy moved (sold out / capacity shrink) —
      // refetch so the guest sees real seats. Other failures say
      // nothing about occupancy; a refetch would just spend a request.
      if (err instanceof ApiError && err.status === 409) {
        void queryClient.invalidateQueries({
          queryKey: queryKeys.publicService.detail(service.id),
        })
      }
    } finally {
      inFlightCount.current--
    }
  }

  /**
   * Login-side failure (fetch error, missing ticket) — no ticket was issued,
   * so nothing is consumed and the guest may tap again. Surface the error in
   * the same slot as booking failures without marking `attempted`.
   */
  function handleTicketError(err: unknown) {
    setError(localizedError(t, err))
    setIsDuplicate(false)
  }

  return {
    step,
    setStep,
    slotId,
    setSlotId,
    selectedOptions,
    setSelectedOptions,
    name,
    setName,
    seats,
    setSeats,
    maxSeats,
    booking,
    error,
    isDuplicate,
    attempted,
    liveNotice,
    liveSeatsLeft,
    pickAnotherSlot,
    bookRemainingSeats,
    backFromVerify,
    reset,
    goFromSlot,
    toggleOption,
    handleTicket,
    handleTicketError,
    isCreating: createBooking.isPending,
  }
}
