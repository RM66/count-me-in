import { loginLinkKey } from '@repo/contracts'
import Redis from 'ioredis'
import postgres from 'postgres'

/**
 * Shared fixtures for the E2E smoke.
 *
 * The scenarios share one database (workers: 1), so the guest-booking spec
 * books on a dedicated **e2e organizer** — the demo account is read-only
 * (ADR-010) and must never receive a booking.
 */

export const E2E_ORG_SLUG = 'e2e-smoke-organizer'
export const E2E_ORG_ID = '01930000-0000-7000-8000-00000000e2e1'
export const E2E_SERVICE_ID = 'svc-e2e-smoke-01'
export const E2E_SLOT_ID = '01930000-0000-7000-8000-00000000e201'

let pg: ReturnType<typeof postgres> | undefined

/** Query the same POSTGRES_URL the app uses (no psql binary needed). */
export function sql(query: string): Promise<Record<string, unknown>[]> {
  const url = process.env.POSTGRES_URL
  if (!url) throw new Error('POSTGRES_URL is not set — E2E needs the docker-compose services')
  if (!pg) pg = postgres(url, { max: 1 })
  return pg.unsafe(query)
}

/** Same as {@link sql} but returns the first cell of the first row. */
export async function sqlValue(query: string): Promise<string> {
  const rows = (await sql(query)) as Record<string, string>[]
  const first = rows[0]
  if (!first) throw new Error(`query returned no rows: ${query}`)
  return Object.values(first)[0]!
}

let redis: Redis | undefined

export function getRedis(): Redis {
  if (!redis) {
    const url = process.env.REDIS_URL
    if (!url) throw new Error('REDIS_URL is not set — E2E needs the docker-compose services')
    redis = new Redis(url)
  }
  return redis
}

/**
 * Seed the e2e organizer + one service + one upcoming slot (idempotent).
 * Slot start is `now + 2 days` so it is always bookable.
 */
export async function seedE2EOrganizer(): Promise<void> {
  await sql(`
    INSERT INTO organizers (id, slug, name, messenger, messenger_id, timezone, language)
    VALUES ('${E2E_ORG_ID}', '${E2E_ORG_SLUG}', 'E2E Smoke Organizer', 'telegram', 'e2e-smoke-messenger', 'UTC', 'en')
    ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name
  `)
  await sql(`
    INSERT INTO services (id, organizer_id, title, default_price, default_capacity, default_duration_minutes, max_seats_per_booking)
    VALUES ('${E2E_SERVICE_ID}', '${E2E_ORG_ID}', 'E2E Smoke Service', '$10', 10, 60, 2)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title
  `)
  await sql(`
    INSERT INTO time_slots (id, service_id, starts_at, duration_minutes, capacity, booked_count)
    VALUES ('${E2E_SLOT_ID}', '${E2E_SERVICE_ID}', now() + interval '2 days', 60, 10, 0)
    ON CONFLICT (id) DO UPDATE SET starts_at = now() + interval '2 days', booked_count = 0
  `)
}

/** Mint a one-time login link for the e2e organizer (the Go job's mint half). */
export async function mintLoginLink(token: string, next = '/cabinet'): Promise<void> {
  await getRedis().set(
    loginLinkKey(token),
    JSON.stringify({ organizerId: E2E_ORG_ID, next }),
    'EX',
    300,
  )
}

/** Mint a guest ticket in Redis the way `/api/auth/telegram-guest` does. */
export async function mintGuestTicket(token: string, messengerId: string): Promise<void> {
  await getRedis().set(
    `auth:ticket:${token}`,
    JSON.stringify({
      messenger: 'telegram',
      messengerId,
      displayName: 'E2E Guest',
      purpose: 'guest',
    }),
    'EX',
    600,
  )
}

/**
 * Dismiss the cookie-consent banner for the page's lifetime: pre-seed the
 * localStorage decision so the banner never renders and never overlays the
 * booking dialog. Call before the first `page.goto`.
 */
export async function skipCookieBanner(page: import('@playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('cmi_cookie_consent', 'rejected')
  })
}
