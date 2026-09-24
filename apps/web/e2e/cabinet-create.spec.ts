import { expect, test } from '@playwright/test'

import {
  E2E_ORG_ID,
  mintGuestTicket,
  mintLoginLink,
  seedE2EOrganizer,
  skipCookieBanner,
  sqlValue,
} from './fixtures'

/**
 * Scenario 2: the cabinet create flow.
 * Login stub = the real login-link flow (mint `{organizerId, next}` in Redis;
 * the POST consume half runs for real and creates the Auth.js session).
 * Then: create a service + slot in the cabinet, book it as a guest via the
 * API, and see the booking in the cabinet table.
 */
test.describe('cabinet create flow', () => {
  test.beforeAll(async () => {
    await seedE2EOrganizer()
  })

  test('organizer creates a service and slot, guest booking appears in the table', async ({
    page,
  }) => {
    await skipCookieBanner(page)
    // ── Login via the one-time link (the mint half of the flow the Go job
    // performs; the consume half runs for real on POST).
    const linkToken = `e2e-login-link-${Date.now()}`
    await mintLoginLink(linkToken)
    await page.goto(`/login/link/${linkToken}`)
    // The form auto-submits (POST) and lands in the cabinet. Dev-mode first
    // compile of the server action is slow — allow a generous timeout.
    await expect(page).toHaveURL(/\/cabinet/, { timeout: 45_000 })
    await expect(page.getByText('E2E Smoke Organizer').first()).toBeVisible({ timeout: 30_000 })

    // ── Create a service.
    await page.goto('/cabinet/services/new')
    await page.getByLabel('Title').fill('E2E Cabinet Service')
    await page.getByLabel('Price').fill('$20')
    await page.getByLabel('Capacity').fill('5')
    await page.getByLabel(/Duration \(min\)/).fill('60')
    await page.getByRole('button', { name: 'Create service' }).click()
    await expect(page).toHaveURL(/\/cabinet\/services/, { timeout: 15_000 })
    await expect(page.getByText('E2E Cabinet Service').first()).toBeVisible()

    const serviceId = await sqlValue(
      `SELECT id FROM services WHERE organizer_id = '${E2E_ORG_ID}' AND title = 'E2E Cabinet Service'`,
    )

    // ── Create a slot for it (tomorrow, 18:00 UTC) on the slots page.
    await page.goto(`/cabinet/slots?service=${serviceId}`)
    await expect(async () => {
      await page.getByRole('button', { name: 'Add slot' }).first().click()
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const dateInput = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
    await page.locator('#slot-date').fill(dateInput)
    await page.locator('#slot-time').fill('18:00')
    await page.locator('#slot-capacity').fill('5')
    await page.getByRole('button', { name: 'Add slot' }).last().click()
    await expect(page.getByText(/18:00/).first()).toBeVisible({ timeout: 15_000 })

    // ── Book it as a guest through the real write path (the full UI flow is
    // scenario 1's job; one request here proves the created slot is bookable).
    const slotId = await sqlValue(
      `SELECT id FROM time_slots WHERE service_id = '${serviceId}' ORDER BY starts_at DESC LIMIT 1`,
    )
    const ticketToken = `e2e-cabinet-ticket-${Date.now()}`
    await mintGuestTicket(ticketToken, `e2e-cab-guest-${Date.now()}`)
    const response = await page.request.post('/api/bookings', {
      data: {
        serviceId,
        timeSlotId: slotId,
        seats: 1,
        guestName: 'Cabinet Flow Guest',
        guestTicket: ticketToken,
        guestLocale: 'en',
      },
    })
    if (response.status() !== 201) {
      console.log('[booking-error]', response.status(), await response.text())
    }
    expect(response.status()).toBe(201)

    // ── The booking is visible in the cabinet table.
    await page.goto('/cabinet/bookings')
    await expect(page.getByText('Cabinet Flow Guest').first()).toBeVisible({ timeout: 15_000 })
  })
})
