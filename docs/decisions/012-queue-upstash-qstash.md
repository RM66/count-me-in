# ADR-012: Job queue on Upstash QStash

- **Status:** Accepted
- **Date:** 2026-08-27

## Context

Production runs entirely on Vercel: the web app (Next.js) natively, Postgres and Redis through the Supabase and Upstash integrations. [ADR-004](004-queue-pg-boss.md) put the job queue in Postgres (`pg-boss`) consumed by a resident `apps/worker` process — but a resident process is exactly what Vercel cannot host, so the worker was never deployed and notifications had no consumer. The legacy `pgboss` schema is removed by migration `0005_drop_pgboss_schema` (`DROP SCHEMA IF EXISTS "pgboss" CASCADE`), applied through the usual pipeline.

## Decision

Replace pg-boss + `apps/worker` with **Upstash QStash**; dissolve the worker's code into `apps/web`:

- **Publish** (`server/queue.ts`): after the booking transaction commits — inside `after()` so the guest's response is not delayed — the route handler publishes to QStash with 5 retries. QStash owns delivery from there.
- **Consume** (`POST /api/jobs/{queue}`): a route handler verifies the `upstash-signature` header and dispatches to handlers under `server/jobs/`, which turn each job into one Telegram message. Status codes are the retry protocol: `500` makes QStash retry, `400`/`404` do not, and an unreachable recipient (never pressed Start) is completed with `200`.
- **Cron**: the demo seed refresh (ADR-010) is a QStash schedule posting to the same route; `apps/web/scripts/ensure-qstash.ts` creates it idempotently, and CI re-runs it on every push to master (`Sync QStash schedule` job) so the schedule in Upstash stays reconciled with the code.
- Queue names and payload schemas stay in `@repo/contracts`; payloads still carry ids only, and handlers still refetch at send time.

## Consequences

- One deployable app; no resident process, no queue schema in Postgres.
- **The transactional enqueue guarantee is lost.** pg-boss inserted jobs inside the booking transaction (shared fate); a QStash publish is an HTTPS call and cannot join it. Publish-after-commit leaves a crash window (commit → publish) in which a booking exists but its notification never sends. Accepted for MVP notifications: the window is milliseconds, the guest's success page already carries the management link, and a publish failure is logged + reported to Sentry rather than failing the request. If losslessness ever becomes a requirement, the migration path is a transactional outbox table swept by a QStash schedule.
- QStash delivers at-least-once; handlers are idempotent in practice because they refetch current state by id.
- Local dev without `QSTASH_TOKEN` skips publishing with a warning; end-to-end delivery requires a publicly reachable `APP_URL` (deployed or tunnel).
- Retry/backoff numbers live on two sides now: publish-time `retries` in `server/queue.ts` and status-code discipline in the receiver — both documented in place.
