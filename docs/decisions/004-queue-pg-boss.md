# ADR-004: Postgres-backed job queue (`pg-boss`)

- **Status:** Superseded by [ADR-012](012-queue-upstash-qstash.md)
- **Date:** 2026-07-18

## Summary

Chose `pg-boss` (Postgres-backed jobs) consumed by a resident `apps/worker` process for MVP notification workloads, keeping Redis for sessions/rate limits/locks only. The rationale: one less moving part for at-least-once delivery, sharing the same Postgres as the domain data.

**Superseded (ADR-012):** production runs entirely on Vercel, which cannot host a resident worker process — the worker was never deployed and notifications had no consumer. ADR-012 replaced pg-boss with Upstash QStash and dissolved the worker's code into `apps/web`; the `pgboss` schema was dropped by migration `0005_drop_pgboss_schema`.
