import { expect, test } from '@playwright/test'

import {
  E2E_ORG_SLUG,
  E2E_SERVICE_ID,
  E2E_SLOT_ID,
  mintGuestTicket,
  mintLoginLink,
  seedE2EOrganizer,
  skipCookieBanner,
  sql,
} from './fixtures'

/**
 * Live occupancy (ADR-025): two guest contexts on the same service page —
 * one books, the other sees the badge change without a reload — plus the
 * organizer cabinet updating on the `organizer:{id}` channel. A second
 * scenario drives the mid-flow shrink notice.
 *
 * Needs resolvable realtime creds — `REDIS_REST_URL` (a real Upstash or
 * the local `redis-http` emulator, e.g.
 * `http://:dev-upstash-token@localhost:8080`) or an Upstash-shaped
 * `REDIS_URL`; mirrors `realtimeRestConfig()` loosely — skip gate only.
 */
const REALTIME_CONFIGURED = Boolean(
  process.env.REDIS_REST_URL?.trim() ||
  /^rediss?:\/\/[^/]*:[^/@]+@.+\.upstash\.io/.test(process.env.REDIS_URL?.trim() ?? ''),
)

/** A capacity-3 sibling slot for the shrink scenario — capacity 10 on the
 * main slot can't produce "fewer seats left than the party wants" with
 * maxSeatsPerBooking = 2 in two API calls. */
const E2E_TIGHT_SLOT_ID = '01930000-0000-7000-8000-00000000e202'

async function seedTightSlot() {
  await sql(`
    INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
    VALUES ('${E2E_TIGHT_SLOT_ID}', '${E2E_SERVICE_ID}', now() + interval '3 days', 60, 3, 0)
    ON CONFLICT (id) DO UPDATE SET starts_at = now() + interval '3 days', booked_count = 0
  `)
}

/** Book `seats` on a slot through the real write path — minted ticket,
 * real `POST /api/bookings`, real post-commit emit. */
async function bookSeats(
  request: import('@playwright/test').APIRequestContext,
  slotId: string,
  seats: number,
) {
  const ticketToken = `e2e-rt-ticket-${Date.now()}-${Math.random().toString(36).slice(2)}`
  await mintGuestTicket(
    ticketToken,
    `e2e-rt-guest-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  const response = await request.post('/api/bookings', {
    data: {
      serviceId: E2E_SERVICE_ID,
      timeSlotId: slotId,
      seats,
      guestName: 'E2E Realtime Guest',
      guestTicket: ticketToken,
      guestLocale: 'en',
    },
  })
  expect(response.status()).toBe(201)
}

test.describe('realtime occupancy', () => {
  test.skip(!REALTIME_CONFIGURED, 'no resolvable realtime creds — realtime is off')

  test.beforeEach(async () => {
    await seedE2EOrganizer()
    await seedTightSlot()
  })

  test('a booking on one guest context updates another guest and the cabinet', async ({
    browser,
    request,
  }) => {
    const viewerCtx = await browser.newContext()
    const orgCtx = await browser.newContext()
    try {
      // Guest B: viewing the page, watching the badge.
      const viewer = await viewerCtx.newPage()
      await skipCookieBanner(viewer)
      await viewer.goto(`/${E2E_ORG_SLUG}/${E2E_SERVICE_ID}`)
      await expect(viewer.getByText('10 seats left')).toBeVisible({ timeout: 15_000 })

      // The cabinet must be open BEFORE the booking — a later navigation
      // would just SSR the new count, proving nothing about the channel.
      const organizer = await orgCtx.newPage()
      await skipCookieBanner(organizer)
      const linkToken = `e2e-rt-login-${Date.now()}`
      await mintLoginLink(linkToken)
      await organizer.goto(`/login/link/${linkToken}`)
      await expect(organizer).toHaveURL(/\/cabinet/, { timeout: 45_000 })
      await organizer.goto(`/cabinet/slots?service=${E2E_SERVICE_ID}`)
      await expect(organizer.getByText(/0\/10 · 10 left/)).toBeVisible({ timeout: 30_000 })

      // Guest A books one seat on the main slot.
      await bookSeats(request, E2E_SLOT_ID, 1)

      // Guest B's badge drops without a reload.
      await expect(viewer.getByText('9 seats left')).toBeVisible({ timeout: 15_000 })

      // The organizer's row follows on the debounced refresh the event scheduled.
      await expect(organizer.getByText(/1\/10 · 9 left/)).toBeVisible({ timeout: 30_000 })
    } finally {
      await viewerCtx.close()
      await orgCtx.close()
    }
  })

  test('a slot shrinking under an open dialog shows the notice and confirms fewer seats', async ({
    browser,
    request,
  }) => {
    // Guest B: open the dialog on the tight slot (capacity 3) and ask for 2.
    const ctx = await browser.newContext()
    try {
      const guest = await ctx.newPage()
      await skipCookieBanner(guest)
      await guest.goto(`/${E2E_ORG_SLUG}/${E2E_SERVICE_ID}`)
      await expect(guest.getByText('3 seats left')).toBeVisible({ timeout: 15_000 })

      await expect(async () => {
        // The tight slot by id — not by row index, so list reordering
        // cannot silently point this at another slot.
        await guest.locator(`[data-slot-id="${E2E_TIGHT_SLOT_ID}"]`).click()
        await expect(guest.getByRole('dialog')).toBeVisible({ timeout: 2_000 })
      }).toPass({ timeout: 30_000 })

      await guest.getByRole('button', { name: 'Continue' }).click()
      await guest.locator('#guest-name').fill('E2E Shrink Guest')
      await guest.getByRole('button', { name: /add a seat/i }).click() // seats 1 → 2

      // Guest A takes 2 of the 3 — only 1 is left under the guest's party of 2.
      await bookSeats(request, E2E_TIGHT_SLOT_ID, 2)

      // The shrink notice appears live; confirm drops the party to 1.
      await expect(guest.getByText(/Only 1 seat left/)).toBeVisible({ timeout: 15_000 })
      await guest.getByRole('button', { name: /Book 1 seat instead/ }).click()
      await expect(guest.getByText(/Only 1 seat left/)).not.toBeVisible()
    } finally {
      await ctx.close()
    }
  })
})
