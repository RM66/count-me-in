/**
 * Recurring refresh of the demo seed (ADR-010).
 *
 * Demo slot times are stored relative to seed time, so a demo left alone drifts
 * into the past and the landing page's "See a live example" link starts showing
 * an organizer with nothing bookable — the failure the hardcoded mock used to
 * have. `seedDemo()` is idempotent and replaces slots and bookings in place.
 */

import { seedDemo } from '@repo/db'

/** Queue backing the schedule. Internal to the worker — nothing else publishes it. */
export const QUEUE_DEMO_REFRESH = 'demo.refresh'

/**
 * Daily, shortly after midnight UTC.
 *
 * Off the hour to stay out of the crowd of cron jobs that fire at :00, and
 * daily because the seed lays out slots across the coming days — anything
 * rarer would let the earliest ones expire.
 */
export const DEMO_REFRESH_CRON = '17 0 * * *'

export async function refreshDemoSeed(): Promise<void> {
  console.log('[demo.refresh] reseeding the demo organizer')
  await seedDemo()
  console.log('[demo.refresh] done')
}
