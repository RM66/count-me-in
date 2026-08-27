/**
 * Ensure the QStash schedule for the demo seed refresh exists (ADR-010, ADR-012).
 *
 * `demo.refresh` has no in-app publisher: its only producer is a QStash
 * **schedule** (cron) that POSTs to `/api/jobs/demo.refresh`. The schedule
 * lives in Upstash, not in this repo, so a fresh environment (or a lost
 * console click) would silently stop refreshing the demo — this script makes
 * the desired state declarative and idempotent:
 *
 * - exactly one schedule targets the demo-refresh destination,
 * - with the cron from `@repo/contracts`,
 * - anything else pointing at the same destination is removed.
 *
 * CI owns the production schedule: on every push to master
 * (`.github/workflows/ci.yml`) this script runs with `APP_URL`, `QSTASH_TOKEN`
 * and `QSTASH_URL` from repo secrets (the URL because the instance is
 * regional — the SDK would otherwise default to the global endpoint). It is
 * idempotent and scoped to the destination derived from `APP_URL`, so a
 * hand-run with different variables manages a different schedule and never
 * touches the production one.
 */

import { DEMO_REFRESH_CRON, QUEUE_DEMO_REFRESH } from '@repo/contracts'
import { Client } from '@upstash/qstash'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

const destination = `${required('APP_URL').replace(/\/+$/, '')}/api/jobs/${QUEUE_DEMO_REFRESH}`
// `baseUrl` passed explicitly (not left to the SDK's env fallback) so a
// regional instance is addressed directly — see the QSTASH_URL note above.
const client = new Client({ token: required('QSTASH_TOKEN'), baseUrl: process.env.QSTASH_URL })

const schedules = await client.schedules.list()
const ours = schedules.filter((schedule) => schedule.destination === destination)

const correct = ours.filter((schedule) => schedule.cron === DEMO_REFRESH_CRON)
const stale = ours.filter((schedule) => schedule.cron !== DEMO_REFRESH_CRON)

for (const schedule of stale) {
  await client.schedules.delete(schedule.scheduleId)
  console.log(`deleted stale schedule ${schedule.scheduleId} (cron "${schedule.cron}")`)
}

if (correct.length === 0) {
  const { scheduleId } = await client.schedules.create({ destination, cron: DEMO_REFRESH_CRON })
  console.log(`created schedule ${scheduleId} — ${destination} at "${DEMO_REFRESH_CRON}"`)
} else {
  // Keep one, drop duplicates: two schedules would double-refresh.
  for (const schedule of correct.slice(1)) {
    await client.schedules.delete(schedule.scheduleId)
    console.log(`deleted duplicate schedule ${schedule.scheduleId}`)
  }
  console.log(
    `schedule ${correct[0]!.scheduleId} already correct — ${destination} at "${DEMO_REFRESH_CRON}"`,
  )
}
