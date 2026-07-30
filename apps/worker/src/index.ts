/**
 * Notification / job worker (pg-boss). Stub until queue + messengers are wired.
 * See docs/architecture.md and docs/decisions/004-queue-pg-boss.md.
 *
 * DEMO ACCOUNT (ADR-010) — required behaviour once jobs are implemented:
 *
 * 1. **Never dispatch notifications for the demo organizer or its guests.**
 *    Guard every handler with `isDemoOrganizerId(organizerId)` from
 *    `@repo/api-contracts`. Demo rows carry sentinel messenger ids
 *    (`demo-account`, `demo-guest-*`) that are not real Telegram accounts, so
 *    sending would fail anyway — but failing loudly on a schedule is noise, and
 *    a future real id collision must not leak messages to a stranger.
 *
 * 2. **Refresh the demo seed on a schedule.** Demo slot times are stored
 *    relative to seed time, so without a periodic refresh the public example
 *    page drifts into the past (exactly what happened with the hardcoded mock).
 *    Register a recurring job that calls `seedDemo()` from `@repo/db` — it is
 *    idempotent and replaces slots/bookings in place.
 */
console.log('[worker] stub — not processing jobs yet')
