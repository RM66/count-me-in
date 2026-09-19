/**
 * Ensure the QStash schedules exist (ADR-010, ADR-012, architecture review fix #3).
 *
 * Two schedules have no in-app publisher — their only producer is a QStash
 * **schedule** (cron) that POSTs to `/api/jobs/{queue}`:
 *
 * - `demo.refresh` — daily demo seed refresh (ADR-010).
 * - `notification.outbox.sweep` — outbox sweeper that re-publishes pending
 *   notification rows the inline publish missed (fix #3).
 *
 * The schedules live in Upstash, not in this repo, so a fresh environment
 * (or a lost console click) would silently stop them — this script makes
 * the desired state declarative and idempotent:
 *
 * - exactly one schedule targets each destination,
 * - with the cron from `@repo/contracts`,
 * - anything else pointing at the same destination is removed.
 *
 * CI owns the production schedules: on every push to master
 * (`.github/workflows/ci.yml`) this script runs with `APP_URL`, `QSTASH_TOKEN`
 * and `QSTASH_URL` from repo secrets (the URL because the instance is
 * regional — the SDK would otherwise default to the global endpoint). It is
 * idempotent and scoped to the destination derived from `APP_URL`, so a
 * hand-run with different variables manages a different schedule and never
 * touches the production one.
 */

import {
  DEMO_REFRESH_CRON,
  OUTBOX_SWEEP_CRON,
  QUEUE_DEMO_REFRESH,
  QUEUE_OUTBOX_SWEEP,
} from '@repo/contracts'
import { Client } from '@upstash/qstash'

function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set`)
  }
  return value
}

const appUrl = required('APP_URL').replace(/\/+$/, '')
// `baseUrl` passed explicitly (not left to the SDK's env fallback) so a
// regional instance is addressed directly — see the QSTASH_URL note above.
const client = new Client({ token: required('QSTASH_TOKEN'), baseUrl: process.env.QSTASH_URL })

/** The schedules this script owns: queue → cron. */
const schedules = [
  { queue: QUEUE_DEMO_REFRESH, cron: DEMO_REFRESH_CRON },
  { queue: QUEUE_OUTBOX_SWEEP, cron: OUTBOX_SWEEP_CRON },
]

const existing = await client.schedules.list()

for (const { queue, cron } of schedules) {
  const destination = `${appUrl}/api/jobs/${queue}`
  const ours = existing.filter((schedule) => schedule.destination === destination)

  const correct = ours.filter((schedule) => schedule.cron === cron)
  const stale = ours.filter((schedule) => schedule.cron !== cron)

  for (const schedule of stale) {
    await client.schedules.delete(schedule.scheduleId)
    console.log(`deleted stale ${queue} schedule ${schedule.scheduleId} (cron "${schedule.cron}")`)
  }

  if (correct.length === 0) {
    const { scheduleId } = await client.schedules.create({ destination, cron })
    console.log(`created ${queue} schedule ${scheduleId} — ${destination} at "${cron}"`)
  } else {
    // Keep one, drop duplicates: two schedules would double-fire.
    for (const schedule of correct.slice(1)) {
      await client.schedules.delete(schedule.scheduleId)
      console.log(`deleted duplicate ${queue} schedule ${schedule.scheduleId}`)
    }
    console.log(
      `${queue} schedule ${correct[0]!.scheduleId} already correct — ${destination} at "${cron}"`,
    )
  }
}
