# ADR-022: Python-first backend — Alembic, SQLAlchemy, zero-Postgres Next.js

- **Status:** Accepted — implemented (`ce3d54d` → `9f2cded` plus review follow-ups). The full phase-by-phase execution plan is preserved in git history.
- **Date:** 2026-09
- **Amends:** [ADR-021](021-api-python-rewrite.md)

## Context

After the Python rewrite (ADR-021) the API still carried raw SQL strings and
positional tuple unpacking (`row[0..47]`), while the schema had two owners:
Drizzle migrations in `packages/db` feeding direct Next.js reads, and the
Python side re-expressing it by hand. `src/server/db/` duplicated the DB layer,
the demo seed existed twice, and Redis was wired twice.

## Decision

1. **Alembic owns the schema.** `apps/web/alembic` with baseline
   `0001_initial_schema.py` consolidates all prior Drizzle revisions;
   `packages/db` (Drizzle, TS seed, TS Redis) is deleted. Drift is pinned by
   `test_models_match_schema` (`alembic check`) and `test_tables_match_schema`.
2. **SQLAlchemy 2.0 declarative models + repositories.** `models/` uses
   `Mapped`/`mapped_column` with `lazy="raise"` relationships; `repositories/`
   holds pure queries. Positional row indexing is banned — reads map ORM
   attributes via `from_model_*`, so a reordered column cannot silently swap
   fields. The atomic seat reserve stays a single conditional
   `UPDATE … WHERE booked_count + :seats <= capacity … RETURNING`,
   pinned by `test_seat_reserve_is_single_conditional_update`.
3. **Services layer between routes and repositories** (`services/`): business
   invariants, transactions, outbox writes, demo guards. Returns `*Row`
   snapshots; wire projection (`to_*_record`) lives in `routes/` only.
4. **Next.js has zero Postgres access.** Server reads go over HTTP via
   `src/server/api-client.ts`; organizer calls carry `X-Organizer-Auth` (HS256
   minted from the Auth.js session), service-to-service calls carry
   `x-internal-secret` (HKDF-derived from `AUTH_SECRET`, constant-time compare).
   `'internal'` joined `ApiAuth` for the Auth.js lookup. New surface for SSR:
   `GET /api/public/organizers/{slug}`, `GET /api/public/services/{id}`,
   `GET /api/public/sitemap`, `POST /api/bookings/manage-lookup` (manageToken in
   the body, never the URL), `GET /api/bookings`, `GET /api/cabinet/summary`,
   `POST /api/internal/auth/organizer-by-messenger`. Each top-level
   `/api/{public,cabinet,internal}` prefix needed a `vercel.json` rewrite.
5. **Dual runtime.** Vercel serverless keeps `NullPool` + no prepared
   statements; the container twin (`apps/web/Dockerfile.api`, root
   `docker-compose.yml` — Postgres + Redis + API + web) uses a queue pool and
   migrates on startup (`alembic upgrade head`).

## Consequences

- One schema owner, one demo seed (`countmein/db/seed.py`), one DB client per
  runtime. `src/server/db/`, `packages/db`, `packages/redis` deleted.
- Real schema as shipped (correcting the original plan text): `services.id` is
  `TEXT` (nanoid) with cascading service→slot FKs; `max_seats_per_booking` is a
  column; `notification_outbox` is `payload TEXT, trace_id, sent_at` with status
  `pending|sent|failed|skipped` — no `next_attempt_at`/`last_error`.
- All invariants carried over and pinned by `tests_py/test_invariants.py`:
  atomic reserve, demo read-only, consumed guest ticket, manage-token
  hash/expiry, delete-409, media ownership, outbox idempotency, wire parity.
