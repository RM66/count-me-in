import type { PublicOrganizer, ServiceRecord, TimeSlotRecord } from '@repo/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { IntlTestProvider } from '@/i18n/test-provider'

/**
 * The live-occupancy UI of the guest flow (ADR-025), at the component
 * level — the hook tests pin the notice's derivation, these pin what
 * the steps DO with it: a slot that filled or shrank mid-flow surfaces
 * the notice and blocks the path forward, and every action resolves it
 * deliberately.
 *
 * Assertions use the real `en` messages through IntlTestProvider — the
 * copy IS the contract here (a renamed key fails visibly).
 */

// The Telegram widget loads an external script — presence/absence is
// what matters, not the widget itself.
vi.mock('@/components/telegram-login-button', () => ({
  TelegramLoginButton: () => <div data-testid="telegram-widget" />,
}))

// SlotList reads the live context from BookingFlow — the hook is
// mocked per-test, the real provider is not needed.
const flowState = vi.hoisted(() => ({
  organizer: {
    id: 'org-1',
    slug: 'yoga-studio',
    name: 'Yoga Studio',
    timezone: 'UTC',
    isDemo: false,
  } as PublicOrganizer,
  service: {
    id: 'svc-1',
    organizerId: 'org-1',
    title: 'Morning Yoga',
    defaultCapacity: 10,
    defaultDurationMinutes: 60,
    defaultPrice: '€15',
    maxSeatsPerBooking: 4,
    options: null,
    optionsSelectMode: null,
  } as ServiceRecord,
  slots: [] as TimeSlotRecord[],
  openFor: vi.fn(),
}))
vi.mock('./booking-flow', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./booking-flow')>()
  return {
    ...actual,
    useBookingFlow: () => ({
      organizer: flowState.organizer,
      service: flowState.service,
      slots: flowState.slots,
      openFor: flowState.openFor,
    }),
  }
})

import { DetailsStep } from './booking-steps/details-step'
import { OptionsStep } from './booking-steps/options-step'
import { SlotStep } from './booking-steps/slot-step'
import { VerifyStep } from './booking-steps/verify-step'
import { SlotList } from './slot-list'

const organizer = {
  id: 'org-1',
  slug: 'yoga-studio',
  name: 'Yoga Studio',
  timezone: 'UTC',
  isDemo: false,
} as PublicOrganizer

const service = {
  id: 'svc-1',
  organizerId: 'org-1',
  title: 'Morning Yoga',
  defaultCapacity: 10,
  defaultDurationMinutes: 60,
  defaultPrice: '€15',
  maxSeatsPerBooking: 4,
  options: null,
  optionsSelectMode: null,
} as ServiceRecord

const optionsService = {
  ...service,
  options: ['Beginner', 'Intermediate'],
  optionsSelectMode: 'single',
} as ServiceRecord

const slot = (over: Partial<TimeSlotRecord> = {}): TimeSlotRecord =>
  ({
    id: 'slot-1',
    serviceId: 'svc-1',
    startsAt: '2026-07-25T09:00:00.000Z',
    durationMinutes: 60,
    capacity: 10,
    bookedCount: 0,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  }) as TimeSlotRecord

function intl(children: ReactNode) {
  return render(<IntlTestProvider>{children}</IntlTestProvider>)
}

const stepCallbacks = {
  onSlotChange: vi.fn(),
  onContinue: vi.fn(),
  onToggleOption: vi.fn(),
  onPickAnotherSlot: vi.fn(),
  onConfirmSeats: vi.fn(),
  onBack: vi.fn(),
  onNameChange: vi.fn(),
  onSeatsChange: vi.fn(),
  onTicket: vi.fn(),
  onTicketError: vi.fn(),
}

describe('SlotStep — a filled pick cannot continue', () => {
  it('disables Continue when the picked slot just filled', () => {
    const full = slot({ bookedCount: 10 })
    intl(
      <SlotStep
        slots={[full]}
        organizer={organizer}
        service={service}
        slotId="slot-1"
        {...stepCallbacks}
      />,
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('disables Continue when the picked slot vanished from the list', () => {
    intl(
      <SlotStep
        slots={[slot({ id: 'other' })]}
        organizer={organizer}
        service={service}
        slotId="slot-1"
        {...stepCallbacks}
      />,
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('keeps Continue enabled on a healthy pick', () => {
    intl(
      <SlotStep
        slots={[slot()]}
        organizer={organizer}
        service={service}
        slotId="slot-1"
        {...stepCallbacks}
      />,
    )
    expect(screen.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })
})

describe('OptionsStep — filled notice', () => {
  it('shows the filled notice and routes "pick another" back', () => {
    intl(
      <OptionsStep
        service={optionsService}
        selectedOptions={[]}
        liveNotice="filled"
        {...stepCallbacks}
      />,
    )
    expect(screen.getByText('This session just filled up.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Pick another time' }))
    expect(stepCallbacks.onPickAnotherSlot).toHaveBeenCalled()
  })
})

describe('DetailsStep — shrunk notice', () => {
  it('shows the live count, keeps the output unclamped, and disables Continue', () => {
    intl(
      <DetailsStep
        name="Jane"
        seats={3}
        maxSeats={4}
        liveNotice="shrunk"
        liveSeatsLeft={2}
        {...stepCallbacks}
      />,
    )
    expect(screen.getByText(/Only 2 seats left/)).toBeInTheDocument()
    // No silent clamp — the guest sees their number, the notice offers
    // the explicit fix instead.
    expect(screen.getByText('3', { selector: 'output' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Book 2 seats instead' }))
    expect(stepCallbacks.onConfirmSeats).toHaveBeenCalled()
  })

  it('the minus stepper stays usable under the notice (decrement resolves it)', () => {
    intl(
      <DetailsStep
        name="Jane"
        seats={3}
        maxSeats={4}
        liveNotice="shrunk"
        liveSeatsLeft={2}
        {...stepCallbacks}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Remove a seat' }))
    expect(stepCallbacks.onSeatsChange).toHaveBeenCalledWith(2)
  })

  it('keeps the stepper when a live shrink drops maxSeats to 1 under a chosen party', () => {
    // Regression: maxSeats === 1 used to hide the whole stepper — the
    // minus button is the guest's only way down from seats 3 → 1.
    intl(
      <DetailsStep
        name="Jane"
        seats={3}
        maxSeats={1}
        liveNotice="shrunk"
        liveSeatsLeft={1}
        {...stepCallbacks}
      />,
    )
    expect(screen.getByRole('button', { name: 'Remove a seat' })).toBeInTheDocument()
    expect(screen.getByText('3', { selector: 'output' })).toBeInTheDocument()
  })

  it('hides the stepper for a solo party on a one-seat ceiling', () => {
    intl(
      <DetailsStep
        name="Jane"
        seats={1}
        maxSeats={1}
        liveNotice={null}
        liveSeatsLeft={1}
        {...stepCallbacks}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Remove a seat' })).not.toBeInTheDocument()
  })
})

describe('VerifyStep — the widget hides while a notice is up', () => {
  const base = {
    ...stepCallbacks,
    organizer,
    error: null,
    isDuplicate: false,
    isCreating: false,
    attempted: false,
    liveSeatsLeft: 2,
    botUsername: 'countmein_bot',
  }

  it('renders the widget normally', () => {
    intl(<VerifyStep {...base} liveNotice={null} />)
    expect(screen.getByTestId('telegram-widget')).toBeInTheDocument()
  })

  it('hides the widget under a filled notice', () => {
    intl(<VerifyStep {...base} liveNotice="filled" />)
    expect(screen.queryByTestId('telegram-widget')).not.toBeInTheDocument()
    expect(screen.getByText('This session just filled up.')).toBeInTheDocument()
  })
})

describe('SlotList — live list drives the empty state', () => {
  it('renders the empty state at zero slots and rows at one', () => {
    flowState.slots = []
    const { rerender } = intl(<SlotList />)
    expect(screen.getByText('No slots yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fully booked' })).toBeDisabled()

    flowState.slots = [slot()]
    rerender(
      <IntlTestProvider>
        <SlotList />
      </IntlTestProvider>,
    )
    expect(screen.queryByText('No slots yet')).not.toBeInTheDocument()
    expect(screen.getByText('10 seats left')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Book now' })).toBeEnabled()

    flowState.slots = []
    rerender(
      <IntlTestProvider>
        <SlotList />
      </IntlTestProvider>,
    )
    expect(screen.getByText('No slots yet')).toBeInTheDocument()
  })
})
