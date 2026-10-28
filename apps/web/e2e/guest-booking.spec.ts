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
 * The Telegram OIDC popup cannot run headless; a `window.open` stub
 * answers the button's own /auth URL with the `auth_result` postMessage
 * oauth.telegram.org would send — a JWT-shaped result carrying the page's
 * nonce — and the "ticket mock" intercepts `/api/auth/telegram-guest`,
 * returning a ticket minted into Redis by the test. The booking then
 * consumes it through the real API write path (require_guest_identity),
 * so the single-use semantics are exercised for real.
 */
test.describe('guest booking flow', () => {
  test.beforeAll(async () => {
    await seedE2EOrganizer()
  })

  test('books a slot and cancels via the manage link', async ({ page }) => {
    await skipCookieBanner(page)
    const ticketToken = `e2e-guest-ticket-${Date.now()}`
    await mintGuestTicket(ticketToken, `e2e-guest-${Date.now()}`)

    // Stub window.open: the button builds the /auth popup URL itself
    // (the stock lib's popup path is upstream-broken). The stub captures
    // the page's nonce from that URL and delivers the auth_result
    // postMessage — origin- and source-checked exactly like the real one.
    await page.addInitScript(() => {
      const w = window as unknown as {
        open: (url: string | URL) => Window | null
      }
      w.open = (url: string | URL) => {
        const nonce = new URL(String(url)).searchParams.get('nonce')
        // A real Window as the popup stand-in: MessageEventInit.source
        // only accepts a Window/MessagePort — a plain object throws
        // "Failed to convert value to 'EventTarget'" in Chromium — and
        // the hook checks `ev.source === popup`, so the same object must
        // be returned here and passed as `source` below.
        const iframe = document.createElement('iframe')
        document.body.appendChild(iframe)
        const popup = iframe.contentWindow as Window
        if (nonce) {
          const payload = btoa(JSON.stringify({ nonce }))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=+$/, '')
          setTimeout(() => {
            window.dispatchEvent(
              new MessageEvent('message', {
                data: JSON.stringify({ event: 'auth_result', result: `e2e.${payload}.stub` }),
                origin: 'https://oauth.telegram.org',
                source: popup,
              }),
            )
            // Like the real popup after postMessage — gone.
            iframe.remove()
          }, 0)
        }
        return popup
      }
    })
    // Belt: the telegram-login.js lib is only needed inside the Telegram
    // WebView — if anything still requests it, it must not overwrite the stub.
    await page.route('**/js/telegram-login.js', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
    })
    // The component POSTs {idToken, nonceVerifier} to
    // /api/auth/telegram-guest; the intercept answers with the
    // pre-minted ticket instead.
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

    // Verify step: click the real button — the stubbed popup delivers
    // the auth_result, the component pairs the nonce, POSTs to the
    // intercepted endpoint and spends the ticket on a booking.
    await page.getByRole('button', { name: 'Confirm with Telegram' }).click()

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
