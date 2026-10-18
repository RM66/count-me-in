'use client'

import type {
  PublicOrganizer,
  PublicServiceViewEnvelope,
  ServiceRecord,
  TimeSlotRecord,
} from '@repo/contracts'
import { createContext, type ReactNode, useContext, useMemo, useState } from 'react'

import { useLivePublicService } from '@/api-client'
import { BookingDialog } from './booking-dialog'

/**
 * One booking dialog for the whole service page — and, since ADR-025, the
 * owner of the page's live slot list.
 *
 * The page used to mount a `BookingDialog` — dialog, state machine and
 * mutation hook — per slot row, shipping `organizer/service/slots` across
 * the RSC boundary N+1 times. Instead this provider wraps the
 * server-rendered slot list: each row's `BookButton` only selects its slot,
 * and a single dialog opens on top.
 *
 * `useLivePublicService` seeds React Query with the server-rendered
 * envelope (`initialData`) so SSR still emits the rows, then invalidates
 * and refetches the cache from the `service:{id}` channel. `SlotList`
 * and the dialog both read this query — occupancy badges and the
 * dialog's seat ceiling can never disagree.
 */
type BookingFlowValue = {
  /** Open the dialog; `slotId` pre-selects the row's session. */
  openFor: (slotId?: string) => void
  organizer: PublicOrganizer
  service: ServiceRecord
  /** The live slot list from the React Query cache, never stale RSC props. */
  slots: TimeSlotRecord[]
}

const BookingFlowContext = createContext<BookingFlowValue | null>(null)

export function useBookingFlow(): BookingFlowValue {
  const ctx = useContext(BookingFlowContext)
  if (!ctx) throw new Error('useBookingFlow must be used inside <BookingFlow>')
  return ctx
}

export function BookingFlow({
  initialView,
  children,
}: {
  /** The server-fetched envelope — seeds the query's first render. */
  initialView: PublicServiceViewEnvelope
  /** The server-rendered header + client SlotList inside the flow. */
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

  const view = useLivePublicService(initialView.service.id, initialView)
  const current = view.data ?? initialView
  const { organizer, service, slots } = current

  const value = useMemo<BookingFlowValue>(
    () => ({
      organizer,
      service,
      slots,
      openFor: (slotId) => {
        setPreselectedSlotId(slotId)
        setOpenCount((count) => count + 1)
        setOpen(true)
      },
    }),
    [organizer, service, slots],
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
