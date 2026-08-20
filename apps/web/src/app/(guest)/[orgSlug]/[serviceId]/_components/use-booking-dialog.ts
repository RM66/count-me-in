'use client'

import type { GuestBooking, GuestTicketResponse, ServiceRecord } from '@repo/contracts'
import { DEFAULT_LOCALE, isAppLocale } from '@repo/contracts'
import { useRouter } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import { useRef, useState } from 'react'

import { useCreateBooking } from '@/api-client'
import { ApiError } from '@/api-client/error'

export type BookingStep = 'slot' | 'options' | 'details' | 'verify' | 'success'

type UseBookingDialogOptions = {
  service: ServiceRecord
  preselectedSlotId?: string
}

/**
 * The state machine behind the guest booking flow (docs/pages.md):
 * pick slot → options → name → Telegram → confirmation.
 *
 * Extracted from [`BookingDialog`](booking-dialog.tsx) so the component is left
 * with rendering only. The last two steps are one round trip each and in a
 * fixed order: the widget proves the identity (`verify`), and only then does
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
    return err instanceof Error ? err.message : t('errorFallback')
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

  return err.message || t('errorFallback')
}

export function useBookingDialog({ service, preselectedSlotId }: UseBookingDialogOptions) {
  const router = useRouter()
  const createBooking = useCreateBooking()
  const t = useTranslations('Booking')
  const locale = useLocale()

  const hasOptions = !!service.options?.length
  const [step, setStep] = useState<BookingStep>('slot')
  const [slotId, setSlotId] = useState<string | undefined>(preselectedSlotId)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [name, setName] = useState('')
  /** Party size. Capped on the details step; the server re-validates it. */
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
   * Concurrent `handleTicket` calls in flight. The widget can fire twice for
   * one tap; the first call gets the real result, the second gets a 401 (ticket
   * already consumed). A 401 with another call still in flight is dropped.
   * Cleared on `reset()`.
   */
  const inFlightCount = useRef(0)

  function reset() {
    setStep('slot')
    setSlotId(preselectedSlotId)
    setSelectedOptions([])
    setName('')
    setSeats(1)
    setBooking(null)
    setError(null)
    setIsDuplicate(false)
    setAttempted(false)
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
   * Widget auth succeeded — spend the ticket on the booking immediately.
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
      // Server-rendered page: refresh so the slot list reflects the taken seat.
      router.refresh()
    } catch (err) {
      // A 401 with another call in flight is the widget double-fire — drop it.
      if (err instanceof ApiError && err.status === 401 && inFlightCount.current > 1) {
        return
      }
      setError(localizedError(t, err))
      setIsDuplicate(err instanceof ApiError && err.code === 'duplicate_booking')
    } finally {
      inFlightCount.current--
    }
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
    booking,
    error,
    isDuplicate,
    attempted,
    reset,
    goFromSlot,
    toggleOption,
    handleTicket,
    isCreating: createBooking.isPending,
  }
}
