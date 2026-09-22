# ADR-012: Job queue on Upstash QStash

- **Status:** Accepted (amended 2026-09-22 — see "Amendments")
- **Date:** 2026-08-27

## Context

Production runs entirely on Vercel: the web app (Next.js) natively, Postgres and Redis through the Supabase and Upstash integrations. [ADR-004](004-queue-pg-boss.md) put the job queue in Postgres (`pg-boss`) consumed by a resident `apps/worker` process — but a resident process is exactly what Vercel cannot host, so the worker was never deployed and notifications had no consumer. The legacy `pgboss` schema is removed by migration `0005_drop_pgboss_schema` (`DROP SCHEMA IF EXISTS "pgboss" CASCADE`), applied through the usual pipeline.

Since [ADR-013](013-api-go-rewrite.md) the write side — including publishing — lives in the Go API (`apps/web/pkg/queue`, `apps/web/pkg/jobs`); the TS route handlers named below were replaced by their Go counterparts.

## Decision

Replace pg-boss + `apps/worker` with **Upstash QStash**; dissolve the worker's code into `apps/web`:

- **Publish** (`pkg/queue/qstash.go`): after the booking transaction commits — inline after the response is flushed, under a bounded 1.5s context, because the Vercel Go runtime has no `after()` hook — the route handler publishes the outbox rows written in that transaction (see Amendments) with 5 retries. QStash owns delivery from there.
- **Consume** (`POST /api/jobs/{queue}`, `pkg/routes/jobs.go`): the handler verifies the `upstash-signature` header and dispatches to handlers under `pkg/jobs/`, which turn each job into one Telegram message. Status codes are the retry protocol: `500` makes QStash retry, `400`/`404` do not, and an unreachable recipient (never pressed Start) is completed with `200`.
- **Cron**: the demo seed refresh (ADR-010) and the outbox sweeper are QStash schedules posting to the same route; `apps/web/scripts/ensure-qstash.ts` creates them idempotently, and CI re-runs it on every push to master (`Sync QStash schedule` job) so the schedules in Upstash stay reconciled with the code.
- Queue names and payload schemas stay in `@repo/contracts`; payloads still carry ids only, and handlers still refetch at send time.

## Consequences

- One deployable app; no resident process, no queue schema in Postgres (the outbox table is a plain table, not a queue schema).
- **The transactional enqueue guarantee is restored** (see Amendments): the booking transaction writes one `notification_outbox` row per recipient; the inline publish delivers them and marks each row `sent`; a crash between commit and publish leaves the row `pending`, and the sweeper schedule re-publishes it past a 30s grace period. The loss window from the original decision is closed.
- QStash delivers at-least-once. Duplicate deliveries of the same outbox row are suppressed by `Upstash-Deduplication-Id` (the row id) — **but only within Upstash's deduplication window (10 minutes by default)**. A re-publish past that window (a stuck `pending` row swept hours later, or a QStash retry after a long backoff) can still produce a duplicate message. This is a bounded, accepted residual: the outbox row id keeps the common cases (inline + sweeper racing, QStash redeliveries) single-delivery, and handlers refetch current state by id so a duplicate message shows the latest booking state rather than a stale one. If duplicates become a user-visible problem, the next step is a consumer-side dedupe (`SET NX EX` on the outbox id before sending), which requires widening the job payload to carry the outbox id.
- Local dev without `QSTASH_TOKEN` skips publishing with a warning; end-to-end delivery requires a publicly reachable `APP_URL` (deployed or tunnel).
- Retry/backoff numbers live on two sides: publish-time `retries` in `pkg/queue/qstash.go` and status-code discipline in the receiver — both documented in place.

## Amendments

**2026-09-22 — transactional outbox completed.** The outbox table existed since migration `0009` but the inline publish never marked rows `sent`, so the sweeper re-published every notification (duplicates), and rows past the retry budget stayed `pending` forever, clogging the sweeper batch. Now:

- `EnqueueOutbox` returns the row; the booking/cancel transactions return their outbox rows to the route handler, which publishes each and calls `MarkOutboxSent` on success (best-effort, in its own context).
- Every publish sends `Upstash-Deduplication-Id = <outbox row id>` — the inline path, the sweeper and QStash retries converge on one delivery per row.
- Rows past `outboxMaxAttempts` move to the terminal `failed` status (migration `0011_outbox_failed_status`); they no longer match the sweeper's `pending` filter, so they cannot block the batch.
- `sent` rows older than 7 days are deleted by the sweeper (retention), keeping the table bounded.
- The original decision text's `after()` hook never existed on the Vercel Go runtime; the publish has always been inline after the response flush. This document now says so.
