'use client'

import type { ComponentProps } from 'react'

import { Button } from '@/components/ui/button'
import { useBookingFlow } from './booking-flow'

/**
 * A "Book" trigger: selecting this row's session and opening the page's one
 * `BookingDialog` (see [`BookingFlow`](booking-flow.tsx)). Rendered inside
 * the server-rendered slot list — the button itself is the only part that
 * needs to be interactive.
 */
export function BookButton({
  slotId,
  children,
  ...buttonProps
}: {
  /** The session this button books; absent = the dialog's own picker. */
  slotId?: string
  children: React.ReactNode
} & Omit<ComponentProps<typeof Button>, 'onClick'>) {
  const { openFor } = useBookingFlow()
  return (
    <Button {...buttonProps} onClick={() => openFor(slotId)}>
      {children}
    </Button>
  )
}
