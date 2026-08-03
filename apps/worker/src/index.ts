/**
 * Notification / job worker (`pg-boss`, ADR-004).
 *
 * Consumes what `apps/web` publishes inside its booking transactions and turns
 * each job into one Telegram message (ADR-008, Telegram first). Queue names and
 * payload schemas come from `@repo/api-contracts` so the two apps cannot drift.
 *
 * Unlike the web publisher this instance **does** supervise: maintenance,
 * expiration and cron belong to exactly one process, and this is it.
 *
 * DEMO ACCOUNT (ADR-010): every handler refuses the demo organizer, and the
 * seed is refreshed on a schedule so the public example never drifts into the
 * past.
 */

import { QUEUE_BOOKING_CANCELLED, QUEUE_BOOKING_CREATED } from '@repo/api-contracts'
import { client as dbClient } from '@repo/db'
import { closeRedis } from '@repo/redis'
import { PgBoss } from 'pg-boss'

import { readEnv, type WorkerEnv } from './env'
import { handleBookingCancelled } from './jobs/booking-cancelled'
import { handleBookingCreated } from './jobs/booking-created'
import { DEMO_REFRESH_CRON, QUEUE_DEMO_REFRESH, refreshDemoSeed } from './jobs/demo-refresh'
import { TelegramUnreachableError } from './telegram/client'

/**
 * Queue policy for the notification queues.
 *
 * Must match the web publisher's `createQueue` options: both processes declare
 * the same queues, and disagreeing about retries would make behaviour depend on
 * which one happened to start first.
 */
const NOTIFICATION_QUEUE_OPTIONS = {
  retryLimit: 5,
  retryBackoff: true,
  expireInSeconds: 120,
} as const

/**
 * Run a handler, absorbing the one failure that must never be retried.
 *
 * A recipient who never pressed Start on the bot cannot be messaged, now or in
 * five minutes (docs/architecture.md). Letting that throw would spend the
 * retry budget and end in `failed`, which reads like an outage in the job
 * table; completing it with a log records the truth — there was nobody to tell.
 * The guest's on-screen success page, which already carries the management
 * link, is the designed fallback.
 */
async function runHandler(name: string, run: () => Promise<void>): Promise<void> {
  try {
    await run()
  } catch (error) {
    if (error instanceof TelegramUnreachableError) {
      console.warn(`[${name}] recipient unreachable — completing without retry:`, error.message)
      return
    }
    throw error
  }
}

async function main(): Promise<void> {
  const env: WorkerEnv = readEnv()

  const boss = new PgBoss({ connectionString: env.databaseUrl })

  // An EventEmitter with no `error` listener would take the process down on the
  // first background connection hiccup.
  boss.on('error', (error) => {
    console.error('[worker] pg-boss error:', error)
  })

  await boss.start()

  await Promise.all([
    boss.createQueue(QUEUE_BOOKING_CREATED, NOTIFICATION_QUEUE_OPTIONS),
    boss.createQueue(QUEUE_BOOKING_CANCELLED, NOTIFICATION_QUEUE_OPTIONS),
    boss.createQueue(QUEUE_DEMO_REFRESH),
  ])

  await boss.work(QUEUE_BOOKING_CREATED, async ([job]) => {
    if (!job) return
    await runHandler(QUEUE_BOOKING_CREATED, () => handleBookingCreated(env, job.data))
  })

  await boss.work(QUEUE_BOOKING_CANCELLED, async ([job]) => {
    if (!job) return
    await runHandler(QUEUE_BOOKING_CANCELLED, () => handleBookingCancelled(env, job.data))
  })

  await boss.work(QUEUE_DEMO_REFRESH, async () => {
    await refreshDemoSeed()
  })

  // Demo slots are seeded relative to seed time, so without this the public
  // example page slides into the past (ADR-010, and exactly what happened with
  // the old hardcoded mock). `seedDemo()` is idempotent.
  await boss.schedule(QUEUE_DEMO_REFRESH, DEMO_REFRESH_CRON)

  console.log('[worker] ready — consuming booking notifications')

  // Drain in-flight jobs before exiting so a deploy does not orphan a job in
  // `active` and leave it to the expiration sweep.
  const shutdown = async (signal: string) => {
    console.log(`[worker] ${signal} received — stopping`)
    try {
      await boss.stop({ graceful: true })
      await closeRedis()
      await dbClient.end()
    } catch (error) {
      console.error('[worker] error during shutdown:', error)
    } finally {
      process.exit(0)
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error) => {
  console.error('[worker] fatal:', error)
  process.exit(1)
})
