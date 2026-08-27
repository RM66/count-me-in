/**
 * Recurring refresh of the demo seed (ADR-010).
 *
 * Demo slot times are stored relative to seed time, so a demo left alone drifts
 * into the past and the landing page's "See a live example" link starts showing
 * an organizer with nothing bookable. `seedDemo()` is idempotent and replaces
 * slots and bookings in place.
 *
 * Scheduled by a **QStash schedule** (cron) that POSTs to
 * `/api/jobs/demo.refresh` — created by `apps/web/scripts/ensure-qstash.ts`,
 * since the schedule lives in Upstash rather than in this codebase.
 */

import { seedDemo } from '@repo/db'

import 'server-only'

export async function refreshDemoSeed(): Promise<void> {
  console.log('[demo.refresh] reseeding the demo organizer')
  await seedDemo()
  console.log('[demo.refresh] done')
}
