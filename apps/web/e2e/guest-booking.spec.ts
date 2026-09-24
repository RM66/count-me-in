import { expect, test } from '@playwright/test'

import {
  E2E_ORG_SLUG,
  E2E_SERVICE_ID,
  E2E_SLOT_ID,
  mintGuestTicket,
  seedE2EOrganizer,
  skipCookieBanner,
  sqlValue,
} from './fixtures'

/**
 * Scenario 1: the guest booking round-trip.
 * `/{orgSlug}/{serviceId}` → slot pick → ticket mock → booking →
 * `/booking/{manageToken}` → cancel.
 *
 * The Telegram widget cannot run headless; the "ticket mock" intercepts
 * `/api/auth/telegram-guest` and returns a ticket minted into Redis by the
 * test — the booking then consumes it through the real Go write path
 * (RequireGuestIdentity), so the single-use semantics are exercised for real.
 */
test.describe('guest booking flow', () => {
  test.beforeAll(async () => {
    await seedE2EOrganizer()
  })

  test('books a slot and cancels via the manage link', async ({ page }) => {
    await skipCookieBanner(page)
    const ticketToken = `e2e-guest-ticket-${Date.now()}`
    await mintGuestTicket(ticketToken, `e2e-guest-${Date.now()}`)

    // The widget posts the Telegram user to /api/auth/telegram-guest; the
    // intercept answers with the pre-minted ticket instead.
    await page.route('**/api/auth/telegram-guest', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ticket: ticketToken,
          messenger: 'telegram',
          messengerId: 'e2e-guest',
          displayName: 'E2E Guest',
        }),
      })
    })

    await page.goto(`/${E2E_ORG_SLUG}/${E2E_SERVICE_ID}`)
    await expect(page.getByRole('heading', { name: 'E2E Smoke Service' })).toBeVisible()
    // Dev-mode hydration is slow — a click before React attaches the
    // DialogTrigger listener does nothing. Retry the click until the dialog
    // actually opens (a no-op once hydrated).
    await expect(async () => {
      await page.getByRole('button', { name: 'Book now' }).first().click()
      await expect(page.getByRole('dialog')).toBeVisible({ timeout: 2_000 })
    }).toPass({ timeout: 30_000 })

    // Pick the (only) slot.
    await page.locator(`#slot-${E2E_SLOT_ID}`).check()
    await page.getByRole('button', { name: 'Continue' }).click()

    // Details step: name is required.
    await page.locator('#guest-name').fill('E2E Guest')
    await page.getByRole('button', { name: 'Continue' }).click()

    // Verify step: fire the widget callback directly — the component then
    // POSTs to the intercepted endpoint and spends the ticket on a booking.
    await page.evaluate(() => {
      const callbackName = Object.keys(window).find((k) => k.startsWith('onTelegramAuth_'))
      if (!callbackName) throw new Error('widget callback not registered')
      const callback = (window as unknown as Record<string, ((u: unknown) => void) | undefined>)[
        callbackName
      ]
      if (!callback) throw new Error('widget callback is not callable')
      callback({
        id: 1,
        first_name: 'E2E',
        last_name: 'Guest',
        username: 'e2e_guest',
        auth_date: Math.floor(Date.now() / 1000),
        hash: `e2e-${Date.now()}`,
      })
    })

    // Success step: the manage link carries the real manageToken.
    const manageLink = page.getByRole('link', { name: 'Manage this booking' })
    await expect(manageLink).toBeVisible({ timeout: 15_000 })
    const manageUrl = await manageLink.getAttribute('href')
    expect(manageUrl).toMatch(/^\/booking\/.+$/)

    // The booking is real: booked_count went up by the booked seats.
    const booked = Number(
      await sqlValue(`SELECT booked_count FROM time_slots WHERE id = '${E2E_SLOT_ID}'`),
    )
    expect(booked).toBeGreaterThanOrEqual(1)

    // Follow the manage link and cancel.
    await manageLink.click()
    await expect(page.getByText('Confirmed').first()).toBeVisible()
    await page.getByRole('button', { name: 'Cancel booking' }).click()
    await page
      .getByRole('button', { name: /cancel/i })
      .last()
      .click()
    await expect(page.getByText('Cancelled').first()).toBeVisible({ timeout: 15_000 })

    // Cancel released the seat.
    const afterCancel = Number(
      await sqlValue(`SELECT booked_count FROM time_slots WHERE id = '${E2E_SLOT_ID}'`),
    )
    expect(afterCancel).toBe(booked - 1)
  })
})
