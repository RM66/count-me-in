# ADR-004: Postgres-backed job queue (`pg-boss`)

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Booking and related events need asynchronous side effects (messenger notifications now; reminders and more providers later). Redis is already planned for sessions, auth ticket TTL, rate limiting, and short locks. Options considered: Redis + BullMQ, external broker (Rabbit/SQS), Postgres-backed jobs.

## Decision

Use **`pg-boss`** (Postgres-backed jobs) consumed by `apps/worker` for MVP notification and reminder workloads.

Redis remains for sessions / rate limits / locks — not for the primary job bus in MVP.

## Consequences

- One less moving part for reliable “at least once” messenger notify after booking (same Postgres as domain data).
- Operational model stays simple for a single-region MVP.
- Throughput and multi-region workers may later justify BullMQ or a dedicated broker; migration path is noted in [roadmap](../roadmap.md) phase 3+.
- Worker must use the shared DB package carefully (migrations own both app tables and `pg-boss` schema).
