/**
 * `pg-boss` publisher — the web app's end of the job queue (ADR-004).
 *
 * Infra singleton, same shape as `redis.ts`: cached on `globalThis` so Next's
 * dev HMR does not open a new pool per reload, and started lazily so importing
 * a module that merely *might* enqueue does not open a connection.
 *
 * **Send-only.** `supervise` and `schedule` are off: maintenance, job
 * expiration and cron belong to `apps/worker`, which runs one instance of each.
 * A Next.js server runs many isolated instances (and serverless ones come and
 * go mid-job), so letting it supervise would have several processes fighting
 * over the same maintenance work.
 *
 * `start()` still runs the schema install/migration, which is deliberate: it
 * means the very first booking can enqueue even if the worker has never been
 * deployed yet, instead of failing on a missing `pgboss` schema. `createQueue`
 * is idempotent, so both processes may declare the same queues.
 */

import {
  type BookingCancelledJob,
  type BookingCreatedJob,
  type CancelActor,
  QUEUE_BOOKING_CANCELLED,
  QUEUE_BOOKING_CREATED,
} from '@repo/api-contracts'
import { sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss } from 'pg-boss'

import 'server-only'

/**
 * The subset of a Drizzle transaction the pg-boss adapter needs.
 *
 * Typed structurally rather than as `PgTransaction<…>`: the callers are already
 * inside `db.transaction()`, and naming the full generic here would drag the
 * whole Drizzle type surface into this module for no benefit.
 */
type Tx = Parameters<typeof fromDrizzle>[0]

const globalForQueue = globalThis as unknown as { boss?: Promise<PgBoss> }

/**
 * How long a notification job may sit unclaimed, and how hard it is retried.
 *
 * Retries are backed off because the failures worth retrying are rate limits
 * and Telegram outages — hammering either makes them worse. Permanent failures
 * (the recipient never pressed Start) are completed by the worker rather than
 * retried, so they never reach this budget.
 */
const NOTIFICATION_QUEUE_OPTIONS = {
  retryLimit: 5,
  retryBackoff: true,
  expireInSeconds: 120,
} as const

/**
 * The started singleton. The promise itself is cached, so concurrent callers
 * during a cold start await one `start()` rather than racing several.
 */
function getBoss(): Promise<PgBoss> {
  if (!globalForQueue.boss) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set')
    }

    globalForQueue.boss = (async () => {
      const boss = new PgBoss({
        connectionString,
        supervise: false,
        schedule: false,
      })

      // Surfaced rather than swallowed: pg-boss emits `error` on background
      // connection trouble, and an EventEmitter with no `error` listener takes
      // the process down.
      boss.on('error', (error) => {
        console.error('[queue] pg-boss error:', error)
      })

      await boss.start()

      await Promise.all([
        boss.createQueue(QUEUE_BOOKING_CREATED, NOTIFICATION_QUEUE_OPTIONS),
        boss.createQueue(QUEUE_BOOKING_CANCELLED, NOTIFICATION_QUEUE_OPTIONS),
      ])

      return boss
    })()

    // A failed start must not be cached forever — the next caller should retry
    // instead of inheriting a permanently rejected promise.
    globalForQueue.boss.catch(() => {
      globalForQueue.boss = undefined
    })
  }

  return globalForQueue.boss
}

/**
 * Publish the two `booking.created` notifications for a fresh booking.
 *
 * **Call inside the booking transaction.** `fromDrizzle(tx, sql)` routes the
 * job insert through the caller's transaction, which is the only way the job
 * and the booking share a fate: published after the commit a job can be lost if
 * the process dies in between, and published on its own connection before the
 * commit it can notify about a booking that then rolls back.
 *
 * One job **per recipient** — see the fan-out note in `api-contracts/jobs.ts`.
 */
export async function enqueueBookingCreated(tx: Tx, bookingId: string): Promise<void> {
  const boss = await getBoss()
  const db = fromDrizzle(tx, sql)

  const jobs: BookingCreatedJob[] = [
    { bookingId, recipient: 'organizer' },
    { bookingId, recipient: 'guest' },
  ]

  await Promise.all(jobs.map((job) => boss.send(QUEUE_BOOKING_CREATED, job, { db })))
}

/**
 * Publish the `booking.cancelled` notification for a cancelled booking.
 *
 * Same transactional contract as {@link enqueueBookingCreated}. Only the actor
 * is recorded; the worker notifies the counterparty.
 */
export async function enqueueBookingCancelled(
  tx: Tx,
  bookingId: string,
  cancelledBy: CancelActor,
): Promise<void> {
  const boss = await getBoss()
  const job: BookingCancelledJob = { bookingId, cancelledBy }

  await boss.send(QUEUE_BOOKING_CANCELLED, job, { db: fromDrizzle(tx, sql) })
}
