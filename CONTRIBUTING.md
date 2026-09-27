# Contributing

Practical guide for working in this repo. Architecture and domain rules live in
[AGENTS.md](AGENTS.md) and [docs/](docs/) — this file is the checklist you run
before opening a PR.

## Setup

```sh
bun install
docker compose up -d          # Postgres + Redis for integration tests
cp .env.example .env           # if not present yet
```

## Before every PR

```sh
bun run lint
bun run check-types
bun run test          # TS (vitest) + Python (pytest) via Turborepo
bun run format:check
```

Integration tests need `POSTGRES_URL` / `REDIS_URL` (docker-compose provides
them; CI runs them against workflow services). They **skip** locally without
the env and **fail** in CI — a red integration test in CI means the service or
the env var was lost, not that the test is flaky.

## E2E smoke

```sh
bun run --cwd packages/db db:seed:demo   # the /demo scenario needs the seed
bun run --cwd apps/web test:e2e
```

Playwright boots the dev topology (`next dev` + the Python API via uvicorn)
against the docker-compose services and runs three scenarios: guest booking
round-trip, cabinet create flow, demo read-only. CI runs the same suite in the
`e2e` job.

The suite creates **real** bookings — never point it at production. Playwright
forces `QSTASH_URL` to an unreachable local address for the API server it
starts, so a populated `.env` cannot publish to the real QStash; a dev server
you started yourself (`reuseExistingServer`) keeps its own env, so stop it or
expect real queue publishes.

## Coverage gates

- **TS** (`apps/web`, `packages/contracts`): `bun run test:coverage`
  (`vitest run --coverage`) enforces thresholds in the vitest configs —
  contracts ≥ 90%, `apps/web/src/{helpers, api-client,server}` ≥ 70%.
  Generated/shadcn/story files are excluded. The plain `test` task runs
  without coverage (fast locally, where skipped integration tests would
  trip the thresholds); CI enforces the gates in the `verify` job's
  `TS coverage thresholds` step, against the migrated database.
- **Python API** (`apps/web`): `uv run pytest` covers the API package
  (`apps/web/api/_lib`); the suite includes the parity replay against the
  frozen golden transcripts and the invariant index
  (`tests_py/test_invariants.py`). CI runs it in the `python-api` job.

## Contract checklist (wire types and routes)

The contract pipeline is standard tooling (ADR-014/015/016); CI already
enforces every item below — **a new wire type without its vector/route fails
CI**, by design. Do not weaken these checks to get a PR green:

1. Build the schema from registered primitives in
   [`packages/contracts/src/wire.ts`](packages/contracts/src/wire.ts) (inputs
   cannot be inline) and `register()` it.
2. Run `bun run generate:py` (generate:i18n:py + generate:openapi +
   generate:constants + generate-py-models.sh) — the generated models and
   the route-set tests pin spec ↔ handler drift.
3. Add `packages/contracts/vectors/validation/{Id}.json` — the shared
   validation vector (the pytest suite runs it).
4. For record schemas add a golden sample, else `test_golden_coverage` is red.
5. If the schema crosses the wire, add the operation to
   [`packages/contracts/src/routes.ts`](packages/contracts/src/routes.ts) —
   the reachability test rejects orphan schemas.
6. A new top-level `/api/...` prefix needs a `vercel.json` rewrite, pinned by
   `tests_py/test_vercel_json.py`.
7. Rule messages must match the spec decode — `scripts/messages.test.ts` pins
   Zod↔API message parity.

## Testing conventions

- Tests are co-located (`*.test.ts(x)` beside source; the Python API suite
  lives in `apps/web/tests_py`, mirroring the package tree).
- One test = one invariant from [docs/domain.md](docs/domain.md) or an ADR;
  name tests after the invariant, not the function.
- Transactions and Redis semantics are tested against **real** services
  (docker-compose locally, workflow services in CI) — mocks hide the bug class
  that matters (Drizzle cache + `Buffer.from(Date)`, `getdel` single-use).
- Every new write route ships with a happy-path test **and** a demo/refusal
  test; every new notification message ships goldens for all 8 locales
  (`--update-goldens` in `tests_py/jobs`).
- The demo organizer (`DEMO_ORGANIZER_ID`) is read-only: every write path,
  including guest booking/cancel, must reject it (ADR-010).
