# CountMeIn — Agent Guide

Simple online booking for group events: organizers publish services with time slots and capacity; guests book on a public web page; organizers manage a web cabinet opened from messenger notification links.

**Host:** `https://countmein.group` — public booking at `/{orgSlug}` (min 4 chars, reserved: `api`, `booking`, `cabinet`, `signup`, `login`, `terms`, `privacy`, `demo`).

Target audience and product framing: see [README.md](README.md) — organizers of group classes, events, and outings; sport, wellness, learning, entertainment, excursions, animals, beauty/professional.

## Stack

- **Runtime / monorepo:** Bun, Turborepo
- **App:** Next.js (`apps/web`) — landing, public booking, organizer cabinet, API
- **UI:** React, Tailwind, shadcn/ui (Radix)
- **State:** TanStack Query (server)
- **Auth:** Auth.js — messenger login only (Telegram Login Widget; `Organizer.id` = user id, identity = `messenger` + `messengerId`)
- **Validation:** Zod (`packages/contracts`)
- **Data:** Postgres (Alembic migrations in `apps/web/alembic`), Redis
- **Media:** Cloudflare R2 (signed upload URLs minted by the Python API; R2 helpers live in `apps/web/api/_lib/countmein/storage.py`)
- **Jobs:** Upstash QStash — `apps/web` publishes after commit, `POST /api/jobs/{queue}` consumes ([ADR-012](docs/decisions/012-queue-upstash-qstash.md))
- **Notifications:** messengers primary (Telegram first); cabinet deep links in messages
- **Observability:** PostHog, Sentry (web); structured JSON stdout logs (`countmein/logx.py`) in the Python API
- **API:** `apps/web/api` — a single Python 3.12 FastAPI (ASGI) Vercel Function: `api/index.py` exports the app from `api/_lib/countmein/app.py`; the TS route handlers have been deleted, `auth/[...nextauth]` stays in Next.js permanently ([ADR-021](docs/decisions/021-api-python-rewrite.md), amends [ADR-016](docs/decisions/016-standard-openapi-codegen.md)). `apps/web/` is the Vercel project root (single project for web + Python API, so env vars are configured once).

No separate organizer native app in MVP — [ADR-006](docs/decisions/006-organizer-capacitor.md). WebSockets out of MVP — [ADR-003](docs/decisions/003-no-websocket-mvp.md).

## Monorepo layout

```
apps/
  web/                 # Next.js: landing + public booking + cabinet + API + job handlers
    src/               # All app source lives under src/ (Next.js src/ convention)
      app/             # App Router: pages, layouts, route handlers
      components/      # React components (shadcn/ui + app components)
      hooks/           # React hooks (shadcn-owned alias `@/hooks`)
      server/          # server-only: api-client (reads), auth, demo (import 'server-only')
      api-client/      # client-only React Query layer — the browser end of the wire
      helpers/         # pure presentation utilities (date, name, contact)
      constants/       # static data tables (timezones, site)
      lib/             # cross-cutting singletons: posthog.ts, og/, utils.ts (cn)
      types/           # TypeScript utility types
      proxy.ts         # Auth.js v5 middleware — src/ root, do not move
      instrumentation.ts # Sentry server-side init
    public/            # Static assets
    pyproject.toml / uv.lock / requirements.txt / .python-version  # uv-managed Python deps; requirements.txt is the Vercel install input
    vercel.json        # function maxDuration config + rewrites routing /api/* to the single Python entry (api/index.py)
    api/               # Python API — a single Vercel Function: api/index.py re-exports the FastAPI app from api/_lib/countmein/app.py (one "fat lambda", not one function per route; _lib/ is not auto-discovered as functions)
    tests_py/          # pytest suite (mirrors the package tree) + parity goldens
    scripts/           # ensure-qstash.ts, generate-openapi.ts, generate-constants.ts, generate-i18n-py.ts, generate-py-models.sh
packages/
  contracts/           # Zod schemas, shared types
  translations/        # web + notification copy (ICU messages per locale, ADR-011)
  eslint-config/       # shared ESLint
  typescript-config/   # shared tsconfig
docs/
```

**Root of `apps/web/` — two kinds of file, only one of them ours.** Everything we organise lives under `src/` (`app/`, `server/`, `api-client/`, `helpers/`, `constants/`, `hooks/`, `components/`, `lib/`, `types/`). What remains at the project root is discovered _by convention_ and its path is load-bearing: `next.config.js`, `postcss.config.mjs`, `tsconfig.json`, `eslint.config.js`, `components.json`, `next-env.d.ts`. Inside `src/`, the convention files are `app/`, `proxy.ts`, `instrumentation.ts` — also load-bearing.

`proxy.ts` is Next 16's rename of `middleware.ts`, found only at the `src/` root (next to `app/`) with **no config option pointing at it**. Moving it breaks auth silently — the `ƒ Proxy (Middleware)` line vanishes from build output and signed-in organizers stop being redirected off `/login` and `/signup`. Contrast `lib/utils.ts`, which _was_ movable because `components.json` holds an alias that can be repointed.

**`apps/web/src/` structure — the data wire is the load-bearing seam:**

- `server/` — **server-only** code; every module carries `import 'server-only'`. Reads go over HTTP to the Python API via `server/api-client.ts` (`api.ts` mints `X-Organizer-Auth`, `internal-api.ts` serves Auth.js); `server/db/` is deleted — Next.js has zero direct Postgres access. The write side (route handlers, guards, QStash, storage, jobs) lives in the Python API.
  - `auth/` — Auth.js config (`index.ts`), signup tickets (`ticket.ts`), `telegram-provider.ts`, `login-link.ts`
  - `demo.ts` — cabinet organizer resolution: `resolveCabinetOrganizerId()` (whose data to show) and `isDemoSession()`. Write-side demo guards live in the Python API.
- `api-client/` — **client-only** React Query layer, one file per entity (`organizer.ts`, `service.ts`, `auth.ts`), each holding queries _and_ mutations. `keys.ts` is the cache-key factory, `client.ts` the fetch helpers, `image.ts` browser-side downscaling. Import via `@/api-client`. The browser end of the wire.
- `helpers/` — pure presentation utilities: formatting and adapters (`date.ts`, `name.ts`, `contact.ts`).
- `constants/` — static data tables (`timezones.ts`, `site.ts`).
- `lib/` — cross-cutting singletons that don't fit a semantic bucket: `posthog.ts` (analytics), `og/` (OpenGraph image assets), `utils.ts` (`cn()`). **`utils.ts` is shadcn-owned:** path is the `utils` alias in `components.json`. Do not add non-shadcn helpers here.

**No `lib/domain/`** — deleted as dead code. Entity invariants live in `packages/contracts` when both client and server need them. Slot calculations (`seatsLeft`, `fillLabel`, `slotEnd`, `slotPrice`) and location/contact override (`effectiveLocation`, `effectiveContact`) live in `@repo/contracts`. Never add a new app-local rules layer — see [ADR-001](docs/decisions/001-monorepo-layout.md).

**No mock data** — `lib/mock-data.ts` was deleted. Sample content is the **demo seed** (`apps/web/api/_lib/countmein/db/seed.py`, invoked by `bun run db:seed:demo`), real rows behind `/demo` (ADR-010). Do not reintroduce fixtures.

**Wall-clock time is a contract.** A slot is stored as `timestamptz` but authored in the organizer's timezone. Both directions live in `packages/contracts/src/timezone.ts` (`wallClockToInstant`, `instantToWallClockInputs`); `helpers/date.ts` stays purely about rendering an instant that already exists.

**Form schemas are not wire schemas.** Controlled inputs hold `string` (including `''` mid-edit), while the API takes numbers and `null`. Each entity has a `*-form.ts` beside its wire schema, with adapters (`optionalText`, `numericText`) shared from `form-fields.ts`. Bounds compose from `primitives.ts`.

**Naming rule — `service` is ambiguous.** The server layer is called `server/`, not `services/`, and server reads live in `server/api-client.ts`. Never reintroduce `services/` **in `src/`** — the rule is scoped to Next.js code; the Python API legitimately has `api/_lib/countmein/services/` (the application layer between routes and repositories, ADR-023).

**`api-client/` vs the Python API** — two ends of one wire. `api-client/` is the browser client (React Query). The Python API (`apps/web/api/_lib/countmein`) holds the server handlers; `app/api/auth/[...nextauth]/route.ts` is the only TS route handler left (Auth.js). They never import each other — contract is HTTP + Zod schemas in `packages/contracts`.

**What belongs in `helpers/`:** a _rendering_ — turns a value into something displayable (`detectContactKind`, `formatDate`). A static table is `constants/`. A _rule_ traceable to [domain.md](docs/domain.md) goes in the layer that enforces it or in `packages/contracts`.

**Query keys live in `api-client/keys.ts`.** Never write a `queryKey` array literal inline — duplicated literals break invalidation silently. Keys are hierarchical, so `queryKeys.services.all` invalidates every service query beneath it.

**Contracts codegen.** Two manifests: `packages/contracts/src/wire.ts` owns payloads (every wire schema registers with its OpenAPI id), and `packages/contracts/src/routes.ts` owns the HTTP surface (method, path, auth, request/response schemas by identity; not re-exported from `index.ts`). The pipeline is standard tooling ([ADR-016](docs/decisions/016-standard-openapi-codegen.md), amended by [ADR-021](docs/decisions/021-api-python-rewrite.md)): `bun run generate:py` renders everything derivable — `generate:i18n:py` (ICU messages → `api/_lib/countmein/i18n/translations_gen.py`), `generate:openapi` (Zod → `apps/web/openapi.yaml` via zod-openapi — the public document — plus `api/_lib/countmein/contracts/spec_gen.json`, the same document as JSON bundled into the function via `includeFiles`), `generate:constants` (→ `api/_lib/countmein/contracts/constants_gen.py`), `generate:rules` (wire `validation` metadata → `api/_lib/countmein/validation/rules_gen.py`) and `scripts/generate-py-models.sh` (datamodel-code-generator → `api/_lib/countmein/contracts/models_gen.py`). The route set is pinned to the spec by `tests_py/test_route_set.py` plus the bidirectional oasdiff contract check, so spec ↔ handler drift is a CI failure. Request validation IS the bundled spec (ADR-024): `validation/decode/core.py` runs declared transforms (from `rules_gen.py`) → `jsonschema` against `spec_gen.json` → declared field rules/refinements → the DTO via `model_construct`; `models_gen.py` provides typed DTOs only, never the validator, and `spec.py` fails closed if the artifact is missing. `fieldErrors` are emitted in spec property order; every error body carries `code` (the i18n key unless the wire pins a different token). The three merge-patch endpoints are `PATCH` (RFC 7386: absent key = keep, explicit `null` = clear); their cross-field pair (`options` + `optionsSelectMode`) must be patched together in both directions — handlers fetch the current row, merge, validate the merged state (declared `mergedRequired` covers keys a patch-`null` would erase), and write only touched columns. A schema with no route is caught by the reachability test (`rejecting orphans`); a new top-level `/api/...` prefix needs a `vercel.json` rewrite, pinned by `tests_py/test_vercel_json.py`. Hand-written code lives outside `*_gen.py` by rule: domain logic in `contracts/domain.py`, x-internal payloads in `contracts/payloads.py`, validation rules in `validation/rules.py`. Never edit `*_gen.py` by hand. To add a schema: (1) build it from registered primitives (inputs cannot be inline), (2) `register()` it in `wire.ts` — with `validation` metadata for anything JSON Schema cannot say (transforms, field rules, refinements, `mergedRequired`), pinned by the parity probes in `wire.test.ts` — (3) run `bun run generate:py`, (4) add `packages/contracts/vectors/validation/{Id}.json`, (5) for records add a golden sample in `tests_py/contracts/golden` (else `test_golden_coverage` is red), (6) if it crosses the wire, add the operation to `routes.ts`. See [ADR-014](docs/decisions/014-contracts-wire-registry.md), [ADR-015](docs/decisions/015-api-route-manifest.md), [ADR-016](docs/decisions/016-standard-openapi-codegen.md), [ADR-021](docs/decisions/021-api-python-rewrite.md).

See [ADR-001](docs/decisions/001-monorepo-layout.md), [ADR-007](docs/decisions/007-cloudflare-r2.md).

## Testing

**Vitest** is the TS test runner; **React Testing Library** covers components and hooks. The Python API suite is **pytest** (mirrors the package tree under `apps/web/tests_py`). TS tests are **co-located** (`*.test.ts` / `*.test.tsx` beside source); Python tests live in `tests_py/`. Run all tests via the Turborepo pipeline:

```sh
bun run test          # all packages (TS vitest; apps/web runs test:web only)
bun run test:py      # the Python API suite (pytest) — a separate, mandatory command
bun run test:watch   # watch mode (vitest)
```

Per-package: `cd <package> && bun run test`. In `apps/web`: `bun run test:web` (Vitest only) or `bun run test:py` (pytest only); `bun run lint:py` runs ruff + mypy.

`bun run test` deliberately does **not** include pytest: the Python suite needs real Postgres/Redis (integration tests fail hard in CI without them), so it runs as its own command and its own CI job (`python-api`), not inside the generic turbo `test` pipeline.

- **`packages/contracts`** — Zod schemas, slot/timezone/options logic (node env).
- **`apps/web`** — helpers, API client, client error classification + link builders, React hooks, components (happy-dom env); the Python API suite in `tests_py/` (`uv run pytest` — includes the parity replay against the frozen golden transcripts and the invariant index `tests_py/test_invariants.py`). Config in `vitest.config.ts`; `server-only` stubbed via `vitest.server-only-stub.ts`; RTL cleanup in `vitest.setup.ts`.

## Documentation

| Doc                                          | Purpose                            |
| -------------------------------------------- | ---------------------------------- |
| [docs/architecture.md](docs/architecture.md) | Surfaces, data flow, infra         |
| [docs/domain.md](docs/domain.md)             | Entities (no Calendar), invariants |
| [docs/pages.md](docs/pages.md)               | Site map / routes by audience      |
| [docs/roadmap.md](docs/roadmap.md)           | MVP vs later                       |
| [docs/decisions/](docs/decisions/)           | ADRs                               |

## Conventions

- No `Calendar` entity; timezone + profile on `Organizer` — [domain](docs/domain.md).
- Messenger-only identity, no phone/OTP — [ADR-008](docs/decisions/008-messenger-only-auth.md) (supersedes [ADR-005](docs/decisions/005-phone-messenger.md)).
- Guest booking without Auth.js accounts (guest = messenger identity via widget); cancel in MVP — [ADR-002](docs/decisions/002-guest-booking.md).
- Seats move only through atomic reserve — a single conditional `UPDATE … WHERE bookedCount + :seats <= capacity` inside the booking transaction; never read `bookedCount`, check in JS, then write back. Bookings are only `confirmed` | `cancelled`.
- Prices are display text only in MVP (no payments).
- Optional display `location` and `contact` on `Organizer` and `Service`; `Service.*` overrides the organizer's — [domain](docs/domain.md).
- Read-only **demo organizer** seeded at `/demo`; identity is `DEMO_ORGANIZER_ID` in `packages/contracts`. Every write path must reject it, including guest booking + cancel, and notifications must never be sent for it — [ADR-010](docs/decisions/010-demo-organizer-account.md). The seed is refreshed daily by a QStash schedule, kept in sync by CI (`apps/web/scripts/ensure-qstash.ts`).
- **`/cabinet` requires no session:** anonymous visitors get the read-only demo cabinet, signed-in organizers get their own. Scope every cabinet read through `resolveCabinetOrganizerId()` and guard every write server-side. `/cabinet/*` is `noindex` — [ADR-010](docs/decisions/010-demo-organizer-account.md). Next.js has **zero direct Postgres access**: all server reads go through `src/server/api-client.ts` over HTTP to the Python API (the `X-Organizer-Auth` header carries the session, anonymous callers get demo scope).
- Guest identity is a **consumed** auth ticket, never a client-supplied `messengerId`. `require_guest_identity()` in the Python API (`apps/web/api/_lib/countmein/web`) is the only way it enters a write; single-use, so a replayed booking fails.
- **Notifications are published to QStash after the booking/cancel transaction commits** (ADR-012), via the Python publisher (`apps/web/api/_lib/countmein/queue.py`), inline after the DB commit. The publisher absorbs its own errors — a notification must never fail a committed booking. Queue names and payloads in `packages/contracts/src/jobs.ts`; jobs carry **ids only**, and the handler refetches at send time. `booking.created` fans out to one job **per recipient**. The job payload's `outboxId` is the consumer idempotency key: `run_job` claims it in Redis (`SET NX`), a duplicate delivery completes without sending, and a **retryable send failure releases the claim** so QStash's retry is processed (at-least-once, duplicates suppressed on success). Dev without `QSTASH_TOKEN` marks rows `skipped` (terminal, honest in the backlog metrics), not `sent`.
- **Deleting a slot or service is refused (409) as soon as any booking row references it — confirmed or cancelled.** Bookings are guest history and no path removes them, so for MVP the 409 is terminal; the copy must not tell the organizer to cancel first. The guards (`delete_owned_slot`, `delete_owned_service`) count every referencing row and map a stray `23503` to the same 409, so ordinary data never yields a 500.
- **QStash deliveries arrive at `POST /api/jobs/{queue}`** (Python: `apps/web/api/_lib/countmein/routes/jobs.py`, routed via the single entry + `vercel.json` rewrite): verify `upstash-signature` before anything else; `500` makes QStash retry, `400`/`404` do not, and dispatch lives in `apps/web/api/_lib/countmein/jobs/run.py`.
- **Organizer deep links are one-time login links.** The notification job mints `{ organizerId, next }` into Redis (`issueLoginLink` in `src/server/auth/login-link.ts`) and links to `/login/link/{token}`, consumed on **`POST`** (never `GET` — previewers fetch URLs before a human clicks). Single-use, `noindex`, demo id refused.
- A Telegram bot may only message users who pressed **Start**: unreachable recipient (`403`, `chat not found`) completes the delivery with a log instead of retrying — only `429`/`5xx`/network are retried.
- `manageToken` is the guest's credential for `/booking/{manageToken}`: generated server-side in the Python API, returned only in `GuestBooking` DTO, passed in **request body** on cancel to stay out of logs and `Referer` headers. The Next.js guest page reads it via the server API client (`src/server/api-client.ts`) but never generates it. **Every credential check goes through the SHA-256 hash** (`manage_token_hash`, unique): `hash_manage_token` in `countmein/db/shared.py`, `hashManageToken` in `@repo/contracts/manage-token` (server-only subpath export — never import it from client code), pinned by a parity vector test on both sides. The raw column stays for the `booking.created` deep-link and re-issue flows only ([ADR-020](docs/decisions/020-manage-token-hash.md)). Tokens expire at slot start + 24h grace (`manage_token_expires_at`; legacy rows backfilled by migration `0014`). Expired tokens are refused on read and on cancel alike; the guest DTO carries `canCancel` (the shared rule: `can_cancel_booking` in the API, `canCancelBooking` in `@repo/contracts`) so the history stays listed but the dead link is not offered — the guest list must never drop rows.
- **Replaced/deleted media is cleaned up best-effort after the commit** (`cleanup_replaced_media` in `countmein/routes` → `storage.delete_replaced_media`): the old R2 object is deleted only if it is the organizer's own media, no `organizers`/`services` row references it (`db.photo_url_referenced` — prefix check, not uniqueness), and old/new URLs resolve to different keys (a cache-buster query string is the same object). Runs as a background task after the response is sent, on a 3s timeout; failures are logged, never fail the request. Orphaned uploads (never saved) are out of scope.
- **Health & security headers:** `/api/healthz` is mounted in `countmein/app.py` outside the OpenAPI spec and needs its `vercel.json` rewrite (pinned by `test_healthz_rewrite`); the probe recovers its own panics (missing connection env → JSON 503 naming the variables) and is IP-rate-limited. `config.validate` fails the production cold start on missing connection/QStash/Telegram vars and on a malformed `APP_URL`; `STRICT_ENV=1` opts any non-production environment into the same validation. `TRUST_PROXY_HEADERS=1` opts a non-Vercel topology into honoring `X-Forwarded-For` (`client_ip`); without it (and outside Vercel) forwarding headers are ignored so a spoofed IP cannot rotate rate-limit keys. CSP is assembled in `next.config.js` from env (R2/PostHog/Sentry origins, telegram.org script, oauth.telegram.org frame); `script-src` carries `'unsafe-eval'` because the Telegram widget evals `data-onauth` — the long-term fix is the OAuth-redirect flow. CSRF stance: no Origin check, minted-header + SameSite is the defense; rate limiter fails open ([ADR-018](docs/decisions/018-cors-same-origin.md), [ADR-019](docs/decisions/019-csrf-and-fail-open.md)); runtime strategy in [ADR-017](docs/decisions/017-runtime-strategy.md), superseded on the API side by [ADR-021](docs/decisions/021-api-python-rewrite.md).
- **i18n (ADR-011):** locale = cookie `NEXT_LOCALE` → `Accept-Language` → `en`, never in URL. Supported set: `LOCALES` (`packages/contracts/src/i18n.ts`); copy in `packages/translations` (`messages/` web, `notifications/` job handlers; en defines the shape). Server `getTranslations`, client `useTranslations`; no hardcoded user-visible strings — ESLint rule `countmein/no-untranslated-strings` enforces it. API errors: the Python route handlers translate via the generated `ApiErrors` copy (error classes keep EN messages for logs); api-client fallbacks are named English constants (documented as such), the display site translates server copy. Job-handler responses carry no body (QStash reads status codes). Notifications: organizer `organizers.language`, guest `bookings.guest_locale`. Times always in the organizer's timezone.
- **Component props are `type`, never `interface`** (declarations named `*Props`; enforced via `no-restricted-syntax` in `apps/web/eslint.config.js`). Other object shapes are the author's choice; in ambient declarations (`**/*.d.ts`) `interface` is the norm — declaration merging there requires it.
- Response DTOs use shape primitives; only request schemas carry policy refinements (reserved slugs, uniqueness) — a response must never fail its own schema ([ADR-015](docs/decisions/015-api-route-manifest.md)).
- Do not expand scope without ADR/roadmap update.
