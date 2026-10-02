# 023 — Post-Refactoring Architecture Follow-Ups & Hardening Plan

> **Status: proposed.** This plan is synthesized from comprehensive code review of commits
> `ce3d54d` → `afb8107` (implementing [ADR-022](022-backend-refactoring-plan.md)) and
> two independent architectural peer reviews. It details the follow-up work needed to bring
> the Python + Next.js architecture to production perfection.

---

## 1. Context & Motivation

[ADR-022](022-backend-refactoring-plan.md) successfully eliminated direct PostgreSQL access from Next.js, transferred schema ownership to Alembic, replaced raw SQL and tuple unpacking (`row[0..47]`) with SQLAlchemy 2.0, expanded the FastAPI read surface for SSR, and delivered containerization alongside Vercel serverless.

A comprehensive review of the final commits (`ce3d54d` through `afb8107`) alongside two architectural peer evaluations identified key areas for follow-up:

1. **Application layer boundary & naming:** The directory `apps/web/api/_lib/countmein/db/` combines low-level DB infrastructure (`client.py`, `seed.py`, `shared.py`) with domain/application services (`service.py`, `organizer.py`, `booking_writes.py`, `time_slot.py`). Furthermore, the layer boundary is heterogeneous: some methods return internal domain models (`OrganizerRow`, `TimeSlotRow`), while others return wire records (`gen.GuestBooking`, `gen.RegisteredOrganizer`).
2. **SSR egress-IP rate-limit exhaustion:** Next.js server-side fetches (`fetchPublicEnvelope`) call the Python API from shared Vercel egress IPs. When crawlers hit uncached pages, all server-side rendering for the site shares the same 60 req/min IP bucket, risking site-wide SSR 500s.
3. **Dead cache tags (absence of `revalidateTag`):** Next.js Data Cache tags (`public-organizer:${slug}`, `public-service:${id}`) are configured with `revalidate: 60`, but `revalidateTag` is never triggered on mutations. Public views remain stale for up to 60 seconds after a booking or service update.
4. **Rate-limiter observability:** The rate-limiter is intentionally fail-open on Redis errors (`(True, 0)`), but issues only one warning every 5 minutes (`warn_every(300)`), making Redis degradation silent without dedicated metric alerts.
5. **FastAPI session lifecycle:** Handlers and services instantiate sessions via direct calls to the module-level `sessionmaker()` singleton instead of using FastAPI's dependency injection (`Depends(get_db_session)`).

---

## 2. Critical Evaluation of Peer Reviews

Before constructing the plan, the two peer reviews were evaluated against the live codebase:

### 2.1 Points Accepted & Incorporated

- **Layer Boundary Inconsistency (Review 1):** Valid and acute. Having `db/booking_reads.py` return `gen.GuestBooking` while `db/time_slot.py` returns `TimeSlotRow` obscures responsibility. The service layer should consistently return domain snapshots (`Row`), leaving wire DTO projection (`to_*_record`) exclusively to route handlers.
- **Preservation of `Row` Snapshots (Review 1):** Confirmed. Collapsing `Model -> Row -> Record` into `Model -> Record` would break `jobs/booking_created.py` and `jobs/booking_cancelled.py`, which consume `get_booking_chain` to read non-wire fields (`guest_messenger_id`, `manage_token_hash`, internal timestamps). `Row` dataclasses also provide safe detached objects outside of SQLAlchemy async sessions with `lazy="raise"`.
- **SSR Egress-IP Bottleneck (Review 2):** Valid and critical for production stability. Next.js server components share Vercel egress IPs. Under crawler traffic, this shared IP will exhaust the 60 req/min limit on `/api/public/*`. The solution is to sign internal SSR calls with `x-internal-secret` and bypass/elevate rate limits for trusted server calls.
- **Uncalled `revalidateTag` (Review 2):** Confirmed. Tags exist in `api-client.ts`, but are never invalidated on-demand.
- **Fail-Open Redis Observability (Review 2):** Confirmed. The fail-open trade-off is architecturally sound (ADR-019), but lacks alerting visibility.

### 2.2 Points Corrected or Rejected

- **Unbounded Public Slots (Review 2):** Review 2 claimed that `get_public_organizer` and `get_public_service` execute unbounded slot queries. **Correction:** This was already addressed in commit `6e50e48` and `afb8107`, which introduced defensive caps (`_PUBLIC_SERVICES_LIMIT = 200`, `_PUBLIC_SLOTS_LIMIT = 500`). We will further harden this by adding a rolling date horizon filter (`starts_at <= now + 90 days`).
- **Complete Elimination of `Row` (Review 1 Option C):** Rejected. As noted above, removing `Row` prematurely removes the decoupling boundary that background workers and notification templates depend on.

---

## 3. Architecture Target & Decisions

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js Frontend / BFF                          │
│                                                                        │
│  ┌───────────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │
│  │ App Router Server     │  │ Auth.js (v5)    │  │ Client UI        │  │
│  │ Components (SSR)      │  │ Session Cookies │  │ (React 19 /      │  │
│  │ Data Cache / Tags     │  │ (BFF Pattern)   │  │  TanStack Query) │  │
│  └──────────┬────────────┘  └────────┬────────┘  └────────┬─────────┘  │
└─────────────┼────────────────────────┼────────────────────┼────────────┘
              │ (x-internal-secret:    │                    │
              │  trusted SSR bypass)   │                    │
              ▼                        ▼                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                         FastAPI Core Service                           │
│                                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Routers (public, cabinet, bookings, internal, jobs)              │  │
│  │ - Session injection via Depends(get_db_session)                  │  │
│  │ - Wire serialization via to_*_record projections                 │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Services Layer (apps/web/api/_lib/countmein/services/)           │  │
│  │ - Business invariants, transactions, outbox, demo guards         │  │
│  │ - Returns domain entities / Row snapshots exclusively            │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Repositories (apps/web/api/_lib/countmein/repositories/)         │  │
│  │ - Pure SQLAlchemy 2.0 async queries, no business rules           │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
│                                     ▼                                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │ Database Infrastructure & Models (db/ & models/)                 │  │
│  │ - SQLAlchemy 2.0 Declarative Models, client.py, Alembic          │  │
│  └──────────────────────────────────┬───────────────────────────────┘  │
└─────────────────────────────────────┼──────────────────────────────────┘
                                      ▼
                           ┌─────────────────────┐
                           │     PostgreSQL      │
                           └─────────────────────┘
```

---

## 4. Phase Breakdown

### Phase 1: Trusted SSR Bypass & Rate-Limit Hardening

**Objective:** Prevent crawler and SSR traffic from exhausting the public rate limits on Vercel egress IPs.

#### 1.1 Header Authentication for Server-Side Fetches

- In `apps/web/src/server/api-client.ts`:
  - Update `fetchPublicEnvelope` to include `x-internal-secret: derivedInternalSecret(authSecret)` whenever `process.env.AUTH_SECRET` is present.
- In `apps/web/api/_lib/countmein/web/deps.py`:
  - Enhance `ip_rate_limit(key_prefix, limit, window_seconds)`:
    - Inspect request header `x-internal-secret`.
    - If `verify_internal_secret(header_value)` returns `True`, bypass the IP rate limiter (or record under a dedicated high-capacity internal bucket `rl:internal-ssr:` with limit = 10,000/min).
    - If absent or invalid, continue enforcing standard client IP rate limiting.

#### 1.2 Rate-Limiter Observability & Degradation Metric

- In `apps/web/api/_lib/countmein/ratelimit.py`:
  - When Redis raises `RedisError` and the limiter fails open:
    - Log a structured event with `{"event": "ratelimit.fail_open", "prefix": key_prefix}`.
    - Sentry capture or error marker when in production.
- Update `docs/decisions/019-csrf-and-fail-open.md` with an explicit "Failure Modes & Degradation Matrix":
  - Identity / Tickets: Fail-closed (Redis down → 500, booking prevented).
  - Rate-limiting: Fail-open (Redis down → allow request, alert ops).
  - Outbox Publishing: Fail-retry (QStash down → rows remain `pending`).

---

### Phase 2: Application Layer Reorganization & Boundary Uniformity

**Objective:** Rename and structure `countmein/db` into proper application services with a homogeneous contract boundary.

#### 2.1 Package Restructuring

Create directory `apps/web/api/_lib/countmein/services/`:

- `booking_service.py` (combines logic from `db/booking_writes.py` and `db/booking_reads.py`)
- `organizer_service.py` (from `db/organizer.py`)
- `service_service.py` (from `db/service.py`)
- `slot_service.py` (from `db/time_slot.py`)
- `outbox_service.py` (from `db/outbox.py`)
- `media_service.py` (from `db/media.py`)

What remains in `apps/web/api/_lib/countmein/db/`:

- `client.py`: Engine, sessionmaker, pool configuration, disposal.
- `rows.py`: Dataclass domain snapshots (`OrganizerRow`, `ServiceRow`, `TimeSlotRow`, `BookingRow`) and ORM mappers `from_model_*`.
- `serializers.py`: Wire projection helpers (`to_service_record`, `to_time_slot_record`, `to_guest_booking`, `to_public_organizer`).
- `shared.py`: Utility functions (`hash_manage_token`, `new_id`, `new_service_id`).
- `seed.py`: Demo seed data generation.

#### 2.2 Uniform Boundary Contract

Enforce that methods in `services/` return **only** domain snapshots (`*Row` / tuples of rows) or domain primitive results. All conversions to wire records (`to_*_record`) must occur inside `routes/`:

- `booking_service.get_guest_booking_by_token(token)`:
  - **Before:** returns `gen.GuestBooking | None`
  - **After:** returns `BookingChain | None` (where `BookingChain = tuple[BookingRow, TimeSlotRow, ServiceRow, OrganizerRow]`).
  - `routes/bookings.py` calls `to_guest_booking(*chain)`.
- `booking_service.list_guest_bookings(messenger, messenger_id)`:
  - **Before:** returns `list[gen.GuestBooking]`
  - **After:** returns `list[BookingChain]`.
  - `routes/bookings.py` iterates and maps via `to_guest_booking`.
- `organizer_service.insert_organizer(...)`:
  - **Before:** returns `gen.RegisteredOrganizer`
  - **After:** returns `OrganizerRow`.
  - `routes/organizers.py` constructs `gen.RegisteredOrganizer(id=row.id, slug=row.slug)`.

#### 2.3 Rolling Slot Query Horizon

- In `services/slot_service.py` and `routes/public.py`:
  - In addition to `starts_at >= now` and `limit = 500`, add a horizon bound: `starts_at <= now + timedelta(days=90)`.
  - Prevents runaway memory allocation when an organizer creates recurring slots years in advance.

---

### Phase 3: On-Demand Cache Invalidation (`revalidateTag`)

**Objective:** Ensure that mutations in the organizer cabinet or guest bookings immediately reflect on public Next.js pages without waiting for the 60s TTL.

#### 3.1 Next.js Internal Revalidation Endpoint

Create `apps/web/src/app/api/internal/revalidate/route.ts`:

- Auth: Verify `x-internal-secret` using `derivedInternalSecret`.
- Accepts JSON body: `{ tags: string[] }`.
- Calls `revalidateTag(tag)` for each provided tag using Next.js `next/cache`.
- Returns `{ revalidated: true, tags }`.

#### 3.2 Invalidation Hooks in Python Services

- Create helper in `apps/web/api/_lib/countmein/web/revalidate.py`:
  - `trigger_revalidation(tags: list[str]) -> None`:
    - Sends an asynchronous HTTP POST to `${APP_URL}/api/internal/revalidate` with `x-internal-secret`.
    - Executed in a `BackgroundTask` so the client response is not delayed.
    - Absorbs errors (logs warning on failure; cache will still expire after 60s fallback).
- Wire invalidation into write operations:
  - Service update / slot update / slot delete: invalidate `public-organizer:${slug}`, `public-service:${service_id}`.
  - Booking confirmed / cancelled: invalidate `public-service:${service_id}`, `public-organizer:${slug}` (so `bookedCount` and availability update instantly).

---

### Phase 4: Dependency Injection for Database Sessions

**Objective:** Standardize session management across FastAPI routes and services using idiomatic dependency injection.

#### 4.1 Define Session Dependency

In `apps/web/api/_lib/countmein/web/deps.py`:

```python
async def get_db_session() -> AsyncIterator[AsyncSession]:
    """Yield an AsyncSession per request with automatic rollback on exception."""
    async with sessionmaker()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
```

#### 4.2 Route-Level Injection

- Update router handlers (starting with `routes/public.py`, `routes/cabinet.py`, `routes/internal.py`) to accept `session: AsyncSession = Depends(get_db_session)`.
- Pass `session` directly into service methods rather than opening ad-hoc sessions within each function.
- Enables clean unit/integration test overrides via `app.dependency_overrides[get_db_session]`.

---

### Phase 5: Codebase Hygiene & Rudiment Removal

**Objective:** Clean up lingering artifacts from prior refactoring phases.

#### 5.1 Artifact Cleanup

1. **`.prettierignore`**:
   - Remove obsolete line `packages/db/drizzle/meta/`.
2. **Docstrings & Comments**:
   - Fix outdated comment in `apps/web/api/_lib/countmein/db/booking_reads.py`: remove reference to cabinet reads living in Next.js.
   - Fix docstring in `apps/web/tests_py/db/test_booking_writes.py`: update reference from "drizzle migrations" to "Alembic migrations".
3. **E2E Playwright Fixtures Documentation**:
   - In `apps/web/e2e/fixtures.ts`: add explicit architecture comment explaining that `postgres` in `devDependencies` is strictly isolated for test database setup/teardown in E2E environments and cannot be imported in `src/`.

---

## 5. Execution Matrix & Priority Order

| Step  | Phase   | Task                                                               | Risk    | Impact                                      |
| :---- | :------ | :----------------------------------------------------------------- | :------ | :------------------------------------------ |
| **1** | Phase 1 | Trusted SSR rate-limit bypass via `x-internal-secret`              | Low     | High (eliminates crawler-induced 500s)      |
| **2** | Phase 5 | Hygiene: `.prettierignore`, docstrings, E2E fixtures documentation | Minimal | Low (cleanliness)                           |
| **3** | Phase 2 | Package restructuring (`db/` -> `services/`, `serializers.py`)     | Medium  | High (clean architecture, uniform boundary) |
| **4** | Phase 2 | Rolling slot horizon limit (`starts_at <= now + 90d`)              | Low     | Medium (memory & payload bounding)          |
| **5** | Phase 3 | On-demand cache invalidation (`revalidateTag` endpoint & hook)     | Medium  | High (real-time availability for guests)    |
| **6** | Phase 4 | FastAPI Dependency Injection for `AsyncSession`                    | Medium  | Medium (idiomatic FastAPI, testability)     |

---

## 6. Definition of Done & Verification

Every phase must satisfy the project's non-negotiable verification gates:

```sh
# 1. Type checking (TypeScript)
bun run check-types

# 2. Frontend unit/component tests (Vitest)
bun run test

# 3. Frontend & repo linting
bun run lint && bun run format:check && bun run knip

# 4. Python formatting and linting
cd apps/web && uv run ruff check . && uv run ruff format --check .

# 5. Python strict type checking
cd apps/web && uv run mypy

# 6. Database schema drift check
cd apps/web && uv run alembic check

# 7. Python test suite (all 710+ tests)
cd apps/web && uv run pytest -n auto

# 8. Invariant AST pins
cd apps/web && uv run pytest tests_py/test_invariants.py

# 9. Next.js production build
bun run build
```
