# ADR-023: Post-refactoring hardening — trusted SSR, services layer, cache invalidation

- **Status:** Accepted — implemented. The full follow-up plan is preserved in git history.
- **Date:** 2026-09
- **Amends:** [ADR-019](019-csrf-and-fail-open.md) (fail-open observability), [ADR-022](022-backend-refactoring-plan.md)

## Context

A review of the ADR-022 codebase found: Next.js SSR fetches share Vercel egress
IPs, so a crawler burst on uncached pages could drain the public IP rate-limit
bucket and 429 every SSR call site-wide; `countmein/db/` mixed DB
infrastructure with application services returning heterogeneous shapes (some
`*Row`, some wire DTOs); Data Cache tags were declared but nothing ever called
`revalidateTag`; the fail-open rate limiter was silent; and sessions were opened
ad-hoc instead of injected.

## Decision

1. **Trusted SSR rate-limit bucket.** Server-side fetches send
   `x-internal-secret`; a valid secret counts against a dedicated
   `rl:internal-ssr:` bucket (10k/min) — a bucket, not a bypass: a runaway SSR
   loop still 429s instead of falling through to Postgres. Verification is
   `verify_internal_secret`, never mere header presence.
2. **Fail-open observability.** A Redis error during `allow()` emits a
   `ratelimit.fail_open` structured event (ERROR in production, WARN elsewhere),
   throttled per bucket to once per 60s. The degradation matrix lives in
   ADR-019.
3. **`services/` application layer.** `countmein/db/` keeps only infrastructure
   (`client.py`, `serializers.py` wire projections, `shared.py`, `seed.py`);
   business logic lives in `services/`. _Amended (2026-10):_ the `*Row`
   dataclass layer was removed — `rows.py` is deleted and services/repositories
   return ORM models directly, which are already detached snapshots under
   `expire_on_commit=False` + `lazy="raise"` (the concern that motivated keeping
   them). Reads with no business rule skip `services/` and go routes →
   repositories; `services/` keeps writes with invariants (booking, slot,
   service, organizer, outbox). `to_*_record` happens in `routes/` as before.
4. **On-demand cache invalidation.** `POST /api/internal/revalidate` (a small
   Next.js route — `revalidateTag` is a Next.js primitive) accepts an
   allowlisted `public-*` tag set under `x-internal-secret`;
   `countmein/web/revalidate.py` posts affected tags in a background task after
   committed writes. Best-effort: a failed call only delays visibility to the
   60s TTL.
5. **Bounded public slot reads.** Public catalog queries cap services/slots and
   add a rolling horizon (`starts_at <= now + 90d`).
6. **DI seam.** `web/deps.py` exposes `get_db_engine` / `get_redis`, resolving
   `app.state` overrides then the process singletons; adopted where needed
   (merge-patch handlers), not as a blanket refactor.

## Consequences

- SSR can no longer be starved by the public bucket; Redis degradation is
  visible in logs instead of silent.
- One dependency direction: routes → services → repositories; wire shapes never
  leak below routes.
- Public pages go stale within a request of a committed write, not a minute.
