'use client'

import type { GuestBooking, GuestTicketResponse, ServiceRecord } from '@repo/api-contracts'
import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { useCreateBooking } from '@/lib/api'

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
export function useBookingDialog({ service, preselectedSlotId }: UseBookingDialogOptions) {
  const router = useRouter()
  const createBooking = useCreateBooking()

  const hasOptions = !!service.options?.length
  const [step, setStep] = useState<BookingStep>('slot')
  const [slotId, setSlotId] = useState<string | undefined>(preselectedSlotId)
  const [selectedOptions, setSelectedOptions] = useState<string[]>([])
  const [name, setName] = useState('')
  /** The completed booking — the only source for the success screen. */
  const [booking, setBooking] = useState<GuestBooking | null>(null)
  /**
   * A failed booking attempt, shown on the `verify` step. Kept in state rather
   * than only as a toast because the common cause is "someone took the last
   * seat", and that has to stay on screen while the guest picks another slot.
   */
  const [error, setError] = useState<string | null>(null)

  function reset() {
    setStep('slot')
    setSlotId(preselectedSlotId)
    setSelectedOptions([])
    setName('')
    setBooking(null)
    setError(null)
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
   * Widget auth succeeded — spend the ticket on the booking straight away.
   *
   * Tickets are short-lived and single-use, so there is nothing to gain by
   * holding one: any pause between the tap and the write is just time for it to
   * expire or for the last seat to go.
   */
  async function handleTicket(ticket: GuestTicketResponse) {
    if (!slotId) return
    setError(null)

    try {
      const result = await createBooking.mutateAsync({
        serviceId: service.id,
        timeSlotId: slotId,
        // One booking is one seat in MVP; `seats` exists on the wire for the
        // group bookings the domain already allows.
        seats: 1,
        guestName: name.trim() || ticket.displayName,
        guestTicket: ticket.ticket,
        selectedOptions: selectedOptions.length > 0 ? selectedOptions : undefined,
      })

      setBooking(result.booking)
      setStep('success')
      // The page is server-rendered, so the new `bookedCount` only appears after
      // a refresh — without this the slot list keeps advertising the seat that
      // was just taken.
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete the booking')
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
    booking,
    error,
    reset,
    goFromSlot,
    toggleOption,
    handleTicket,
    isCreating: createBooking.isPending,
  }
}
