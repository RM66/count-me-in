'use client'

import type { PublicOrganizer, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

import { BookingDialog } from './booking-dialog'

/**
 * One booking dialog for the whole service page.
 *
 * The page used to mount a `BookingDialog` — dialog, state machine and
 * mutation hook — per slot row, shipping `organizer/service/slots` across
 * the RSC boundary N+1 times. Instead this provider wraps the
 * server-rendered slot list: each row's `BookButton` only selects its slot,
 * and a single dialog opens on top.
 */
type BookingFlowValue = {
  /** Open the dialog; `slotId` pre-selects the row's session. */
  openFor: (slotId?: string) => void
}

const BookingFlowContext = createContext<BookingFlowValue | null>(null)

export function useBookingFlow(): BookingFlowValue {
  const ctx = useContext(BookingFlowContext)
  if (!ctx) throw new Error('useBookingFlow must be used inside <BookingFlow>')
  return ctx
}

export function BookingFlow({
  organizer,
  service,
  slots,
  children,
}: {
  organizer: PublicOrganizer
  service: ServiceRecord
  slots: TimeSlotRecord[]
  /** The server-rendered slot list — the trigger buttons live inside it. */
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  /** Which session the dialog opens on — set by the tapped row's button. */
  const [preselectedSlotId, setPreselectedSlotId] = useState<string | undefined>()
  /**
   * Remount counter: each `openFor` gets a fresh dialog instance, so the
   * state machine always starts clean — the picked slot, not whatever the
   * previous run left behind (including a finished `success` screen).
   * Radix's `onOpenChange` cannot do this: it only fires on user gestures,
   * never on the controlled `open` flipping true.
   */
  const [openCount, setOpenCount] = useState(0)

  const value = useMemo<BookingFlowValue>(
    () => ({
      openFor: (slotId) => {
        setPreselectedSlotId(slotId)
        setOpenCount((count) => count + 1)
        setOpen(true)
      },
    }),
    [],
  )

  return (
    <BookingFlowContext.Provider value={value}>
      {children}
      <BookingDialog
        key={openCount}
        organizer={organizer}
        service={service}
        slots={slots}
        preselectedSlotId={preselectedSlotId}
        open={open}
        onOpenChange={setOpen}
      />
    </BookingFlowContext.Provider>
  )
}
