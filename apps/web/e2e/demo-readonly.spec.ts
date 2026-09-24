import { expect, test } from '@playwright/test'
import { DEMO_ORGANIZER_ID } from '@repo/contracts'

import { mintGuestTicket, skipCookieBanner, sql } from './fixtures'

/**
 * Scenario 3: the demo account is read-only — checked at the
 * server guard, not just the UI. `/demo` (the demo organizer's public page)
 * renders the demo banner instead of the Telegram widget, and the API
 * refuses writes against the demo organizer with 403 (ADR-010).
 */
test.describe('demo read-only', () => {
  test('demo page shows the read-only notice and the API refuses demo writes', async ({
    page,
    request,
  }) => {
    await skipCookieBanner(page)
    // ── Public demo page renders the seeded demo organizer.
    await page.goto('/demo')
    await expect(page.getByText('Studio Demo').first()).toBeVisible()

    // ── The booking flow on a demo service page shows the read-only notice
    // instead of the Telegram widget (the UI affordance — the widget never
    // renders, so no booking can even be attempted from the demo).
    await page.goto('/demo/demo-yoga')
    await expect(async () => {
      await page.getByRole('button', { name: 'Book now' }).first().click()
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    // Pick the first enabled slot radio, then Continue through to the verify
    // step where the demo notice appears.
    await page.getByRole('radio').first().check()
    await page.getByRole('button', { name: 'Continue' }).click()
    // The demo yoga service has single-select options — pick one, then the
    // options step's Continue becomes enabled.
    await page.getByRole('radio', { name: /Downtown studio/i }).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    // The flow lands on the details step (Full name, seats) before verify.
    await page.getByRole('textbox', { name: 'Full name' }).fill('Demo Flow Guest')
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByText(/read-only demo page/i)).toBeVisible()

    // ── Anonymous cabinet shows the demo data (ADR-010: no 401).
    await page.goto('/cabinet')
    await expect(page.getByText(/demo/i).first()).toBeVisible({ timeout: 15_000 })

    // ── Server-side guard: a write against the demo organizer is refused
    // even with a perfectly valid payload and a real guest ticket.
    // Slot and service must come from the same row: the booking chain-select
    // requires the slot to belong to the given service.
    const demoRow = (
      await sql(
        `SELECT ts.id AS slot_id, s.id AS service_id FROM time_slots ts
         JOIN services s ON s.id = ts.service_id
         WHERE s.organizer_id = '${DEMO_ORGANIZER_ID}' AND ts.starts_at > now()
         ORDER BY ts.starts_at LIMIT 1`,
      )
    )[0] as { slot_id: string; service_id: string }
    const demoSlotId = demoRow.slot_id
    const demoServiceId = demoRow.service_id
    const ticketToken = `e2e-demo-ticket-${Date.now()}`
    await mintGuestTicket(ticketToken, `e2e-demo-guest-${Date.now()}`)

    const booking = await request.post('/api/bookings', {
      data: {
        serviceId: demoServiceId,
        timeSlotId: demoSlotId,
        seats: 1,
        guestName: 'Demo Refusal Guest',
        guestTicket: ticketToken,
        guestLocale: 'en',
      },
    })
    expect(booking.status()).toBe(403)

    // ── Organizer writes are refused too: no session → anonymous → demo
    // organizer → read-only. Deterministically 403, not 401: the guard
    // answers every unauthenticated write as the demo refusal.
    const serviceWrite = await request.post('/api/services', {
      data: { title: 'Hack', defaultPrice: '$1', defaultCapacity: 1, defaultDurationMinutes: 30 },
    })
    expect(serviceWrite.status()).toBe(403)
  })
})
