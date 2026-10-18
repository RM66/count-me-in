import type {
  PublicOrganizer,
  PublicServiceViewEnvelope,
  ServiceRecord,
  TimeSlotRecord,
} from '@repo/contracts'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { IntlTestProvider } from '@/i18n/test-provider'
import { BookButton } from './book-button'
import { BookingFlow } from './booking-flow'

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

// Keep the real realtime/channel wrappers' neighbours, stub the live
// pieces: no SSE subscription and no network reconcile in jsdom.
vi.mock('@/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api-client')>()
  return {
    ...actual,
    useCreateBooking: () => ({ mutateAsync: vi.fn(), isPending: false }),
    useRealtimeConfigured: () => false,
    useLivePublicService: (_id: string, initial: PublicServiceViewEnvelope) => ({
      data: initial,
    }),
  }
})

// ── Fixtures ─────────────────────────────────────────────────────────────────

const organizer: PublicOrganizer = {
  id: 'org-1',
  slug: 'yoga-studio',
  name: 'Yoga Studio',
  timezone: 'Europe/Belgrade',
  description: null,
  photoUrl: null,
  location: null,
  contact: null,
  isDemo: false,
} as PublicOrganizer

const service: ServiceRecord = {
  id: 'svc-1',
  organizerId: 'org-1',
  title: 'Morning Yoga',
  description: null,
  photoUrl: null,
  location: null,
  contact: null,
  defaultPrice: '€15',
  defaultCapacity: 10,
  defaultDurationMinutes: 60,
  maxSeatsPerBooking: 1,
  options: null,
  optionsSelectMode: null,
  createdAt: '2026-01-01T00:00:00.000Z',
} as ServiceRecord

const slot = (id: string, day: string): TimeSlotRecord =>
  ({
    id,
    serviceId: 'svc-1',
    startsAt: `2026-07-${day}T09:00:00.000Z`,
    durationMinutes: 60,
    capacity: 10,
    bookedCount: 0,
    price: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  }) as TimeSlotRecord

const slots = [
  slot('5f20f0e0-0000-4000-8000-000000000001', '21'),
  slot('5f20f0e0-0000-4000-8000-000000000002', '22'),
]

const initialView = { organizer, service, slots } as PublicServiceViewEnvelope

function renderFlow() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <IntlTestProvider>
        <BookingFlow initialView={initialView}>
          <BookButton slotId={slots[0]!.id}>Book Monday</BookButton>
          <BookButton slotId={slots[1]!.id}>Book Tuesday</BookButton>
        </BookingFlow>
      </IntlTestProvider>
    </QueryClientProvider>,
  )
}

function checkedRadioId(): string | null {
  const radios = screen.queryAllByRole('radio')
  return radios.find((r) => r.getAttribute('aria-checked') === 'true')?.id ?? null
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('BookingFlow', () => {
  it("opens the single dialog with the tapped row's slot preselected", () => {
    renderFlow()

    fireEvent.click(screen.getByRole('button', { name: 'Book Tuesday' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(checkedRadioId()).toBe(`slot-${slots[1]!.id}`)
  })

  it('reopens with a fresh state machine and the newly tapped slot', () => {
    renderFlow()

    // First open: pick the Tuesday row and advance past the slot step.
    fireEvent.click(screen.getByRole('button', { name: 'Book Tuesday' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // Details step reached — the slot picker is gone.
    expect(screen.queryAllByRole('radio')).toHaveLength(0)

    // Close via Escape, then open from the Monday row.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Book Monday' }))

    // The dialog is back at the slot step — remounted, not the stale state —
    // and the *new* row's slot is selected.
    expect(checkedRadioId()).toBe(`slot-${slots[0]!.id}`)
  })
})
