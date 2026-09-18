# CountMeIn — Agent Guide

Simple online booking for group events: organizers publish services with time slots and capacity; guests book on a public web page; organizers manage a web cabinet opened from messenger notification links.

**Host:** `https://countmein.group` — public booking at `/{orgSlug}` (min 4 chars, reserved: `api`, `booking`, `cabinet`, `signup`, `login`, `terms`, `privacy`, `demo`).

## Target audience

Organizers of group classes, events, and outings who need to manage schedule, capacity, and bookings without endless chats and spreadsheets.

- **Sport & active recreation** — group training, team sports, dance, martial arts, running/cycling/climbing clubs, SUP/kayak/surf/ski.
- **Wellness & practices** — meditation, breathwork, sound healing, bath ceremonies, retreats, support groups.
- **Learning & creativity** — masterclasses, courses, workshops, art/ceramics/photography, cooking, music, language clubs.
- **Entertainment & communities** — quizzes, mafia, board/RPG games, book/film clubs, networking, speed dating, kids' events, expat communities.
- **Excursions & outings** — city walks, food tours, hiking, camping, diving, fishing, yachting, wine/foraging/gastro tours.
- **Animals** — group sessions with a cynologist, dog socialization, training, horseback, pet-friendly events.
- **Beauty & professional services** — group beauty procedures, makeup/styling lessons, group consultations, coworking sessions, mastermind groups.

## Stack

- **Runtime / monorepo:** Bun, Turborepo
- **App:** Next.js (`apps/web`) — landing, public booking, organizer cabinet, API
- **UI:** React, Tailwind, shadcn/ui (Radix)
- **State:** TanStack Query (server)
- **Auth:** Auth.js — messenger login only (Telegram Login Widget; `Organizer.id` = user id, identity = `messenger` + `messengerId`)
- **Validation:** Zod (`packages/contracts`)
- **Data:** Postgres, Drizzle ORM, Redis
- **Media:** Cloudflare R2 (signed upload URLs minted by the Go API; `packages/media-storage` deleted — R2 helpers now live in `apps/web/pkg/storage`)
- **Jobs:** Upstash QStash — `apps/web` publishes after commit, `POST /api/jobs/{queue}` consumes ([ADR-012](docs/decisions/012-queue-upstash-qstash.md))
- **Notifications:** messengers primary (Telegram first); cabinet deep links in messages
- **Observability:** PostHog, Sentry (web); structured JSON stdout logs (`internal/logx`) in the Go API
- **API:** `apps/web/api` + `apps/web/internal` — Vercel Functions, `net/http` only; the TS route handlers have been deleted, `auth/[...nextauth]` stays in Next.js permanently ([ADR-013](docs/decisions/013-api-go-rewrite.md)). `apps/web/` is the Vercel project root (single project for web + Go API, so env vars are configured once).

No separate organizer native app in MVP — [ADR-006](docs/decisions/006-organizer-capacitor.md). WebSockets out of MVP — [ADR-003](docs/decisions/003-no-websocket-mvp.md).

## Monorepo layout

```
apps/
  web/                 # Next.js: landing + public booking + cabinet + API + job handlers
    src/               # All app source lives under src/ (Next.js src/ convention)
      app/             # App Router: pages, layouts, route handlers
      components/      # React components (shadcn/ui + app components)
      hooks/           # React hooks (shadcn-owned alias `@/hooks`)
      server/          # server-only: db (reads), auth, demo (import 'server-only')
      api-client/      # client-only React Query layer — the browser end of the wire
      helpers/         # pure presentation utilities (date, name, contact)
      constants/       # static data tables (timezones, site)
      lib/             # cross-cutting singletons: posthog.ts, og/, utils.ts (cn)
      types/           # TypeScript utility types
      proxy.ts         # Auth.js v5 middleware — src/ root, do not move
      instrumentation.ts # Sentry server-side init
    public/            # Static assets
    go.mod / go.sum    # module "countmein" — shared by api/ and pkg/
    vercel.json        # Go function memory/maxDuration config + rewrites routing /api/* to the single entry
    api/               # Go API — a single Vercel Function: api/entry/index.go dispatches via pkg/routes.NewMux (one "fat lambda", not one function per route)
    pkg/               # contracts, validation, db, auth, i18n, httpx, jobs, queue, storage, demo, logx, routes (not internal/ — Vercel compiles api/ under a handler/ module prefix, and Go's internal visibility rule would block it)
    cmd/dev/           # local dev server (never deployed)
    scripts/           # build-go.sh, check-api-routes.ts, ensure-qstash.ts, generate-contracts.ts, generate-i18n-go.ts
packages/
  db/                  # Drizzle schema, migrations
  redis/               # ioredis singleton (tickets, login links, rate limits)
  contracts/           # Zod schemas, shared types
  translations/        # web + notification copy (ICU messages per locale, ADR-011)
  storage/             # Cloudflare R2 helpers
  eslint-config/       # shared ESLint
  typescript-config/   # shared tsconfig
docs/
```

**Root of `apps/web/` — two kinds of file, only one of them ours.** Everything we organise lives under `src/` (`app/`, `server/`, `api-client/`, `helpers/`, `constants/`, `hooks/`, `components/`, `lib/`, `types/`). What remains at the project root is discovered _by convention_ and its path is load-bearing: `next.config.js`, `postcss.config.mjs`, `tsconfig.json`, `eslint.config.js`, `components.json`, `next-env.d.ts`. Inside `src/`, the convention files are `app/`, `proxy.ts`, `instrumentation.ts` — also load-bearing.

`proxy.ts` is Next 16's rename of `middleware.ts`, found only at the `src/` root (next to `app/`) with **no config option pointing at it**. Moving it breaks auth silently — the `ƒ Proxy (Middleware)` line vanishes from build output and signed-in organizers stop being redirected off `/login` and `/signup`. Contrast `lib/utils.ts`, which _was_ movable because `components.json` holds an alias that can be repointed.

**`apps/web/src/` structure — the data wire is the load-bearing seam:**

- `server/` — **server-only** code; every module carries `import 'server-only'`. Read-only Postgres access for pages + Auth.js config. The write side (route handlers, guards, QStash, storage, jobs) moved to the Go API.
  - `auth/` — Auth.js config (`index.ts`), signup tickets (`ticket.ts`), `telegram-provider.ts`, `login-link.ts`
  - `db/` — Postgres **reads only** + DTO mapping, one file per entity (`organizer.ts`, `service.ts`, `booking.ts`, `time-slot.ts`). Writes moved to the Go API; these modules serve pages that read Postgres directly (cabinet, public pages, sitemap, OG images).
  - `demo.ts` — cabinet organizer resolution: `resolveCabinetOrganizerId()` (whose data to show) and `isDemoSession()`. Write-side demo guards moved to the Go API.
- `api-client/` — **client-only** React Query layer, one file per entity (`organizer.ts`, `service.ts`, `auth.ts`), each holding queries _and_ mutations. `keys.ts` is the cache-key factory, `client.ts` the fetch helpers, `image.ts` browser-side downscaling. Import via `@/api-client`. The browser end of the wire.
- `helpers/` — pure presentation utilities: formatting and adapters (`date.ts`, `name.ts`, `contact.ts`).
- `constants/` — static data tables (`timezones.ts`, `site.ts`).
- `lib/` — cross-cutting singletons that don't fit a semantic bucket: `posthog.ts` (analytics), `og/` (OpenGraph image assets), `utils.ts` (`cn()`). **`utils.ts` is shadcn-owned:** path is the `utils` alias in `components.json`. Do not add non-shadcn helpers here.

**No `lib/domain/`** — deleted as dead code. Entity invariants live in `server/db/` or `packages/contracts` when both client and server need them. Slot calculations (`seatsLeft`, `fillLabel`, `slotEnd`, `slotPrice`) and location/contact override (`effectiveLocation`, `effectiveContact`) live in `@repo/contracts`. Never add a new app-local rules layer — see [ADR-001](docs/decisions/001-monorepo-layout.md).

**No mock data** — `lib/mock-data.ts` was deleted. Sample content is the **demo seed** (`packages/db/src/seed/`), real rows behind `/demo` (ADR-010). Do not reintroduce fixtures.

**Wall-clock time is a contract.** A slot is stored as `timestamptz` but authored in the organizer's timezone. Both directions live in `packages/contracts/src/timezone.ts` (`wallClockToInstant`, `instantToWallClockInputs`); `helpers/date.ts` stays purely about rendering an instant that already exists.

**Form schemas are not wire schemas.** Controlled inputs hold `string` (including `''` mid-edit), while the API takes numbers and `null`. Each entity has a `*-form.ts` beside its wire schema, with adapters (`optionalText`, `numericText`) shared from `form-fields.ts`. Bounds compose from `primitives.ts`.

**Naming rule — `service` is ambiguous.** The server layer is called `server/`, not `services/`, and entity files live at `server/db/service.ts` (kind → entity). Never reintroduce `services/`.

**`api-client/` vs the Go API** — two ends of one wire. `api-client/` is the browser client (React Query). The Go API (`apps/web/api` + `apps/web/internal`) holds the server handlers; `app/api/auth/[...nextauth]/route.ts` is the only TS route handler left (Auth.js). They never import each other — contract is HTTP + Zod schemas in `packages/contracts`.

**What belongs in `helpers/`:** a _rendering_ — turns a value into something displayable (`detectContactKind`, `formatDate`). A static table is `constants/`. A _rule_ traceable to [domain.md](docs/domain.md) goes in the layer that enforces it or in `packages/contracts`.

**Query keys live in `api-client/keys.ts`.** Never write a `queryKey` array literal inline — duplicated literals break invalidation silently. Keys are hierarchical, so `queryKeys.services.all` invalidates every service query beneath it.

**Contracts codegen.** Two manifests: `packages/contracts/src/wire.ts` owns payloads (every wire schema registers with its Go name and kind `primitive` | `enum` | `input` | `update` | `record`; registration order is emission order), and `packages/contracts/src/routes.ts` owns the HTTP surface (method, path, auth, request/response schemas by identity; not re-exported from `index.ts`). `bun run generate:contracts` derives Go structs, validation rules, `Parse*` + `Parsers`, `RecordNames`, `APIRoutes`, and `apps/web/openapi.yaml` from the registry plus the route table. Hand-written code lives outside `*_gen.go` by rule: domain logic in `pkg/contracts/domain.go` / `data.go`, validation rules in `pkg/validation/rules.go`, input refinements in `pkg/validation/refine.go`. Never edit `*_gen.go` by hand. To add a schema: (1) build it from registered primitives (inputs cannot be inline), (2) `register()` it in `wire.ts`, (3) run `generate:contracts` (a named `x-go-refine` without its function fails), (4) add `packages/contracts/vectors/validation/{Id}.json`, (5) for records add a golden sample (else `TestGoldenCoverage` is red), (6) if it crosses the wire, add the operation to `routes.ts` — otherwise generation fails with an orphan-schema error. See [ADR-014](docs/decisions/014-contracts-wire-registry.md), [ADR-015](docs/decisions/015-api-route-manifest.md).

See [ADR-001](docs/decisions/001-monorepo-layout.md), [ADR-007](docs/decisions/007-cloudflare-r2.md).

## Testing

**Vitest** is the TS test runner; **React Testing Library** covers components and hooks. Go tests use standard `go test`. Tests are **co-located** (`*.test.ts` / `*.test.tsx` / `*_test.go` beside source). Run all tests via the Turborepo pipeline:

```sh
bun run test          # all packages (TS vitest + Go tests)
bun run test:watch    # watch mode (vitest)
```

Per-package: `cd <package> && bun run test`. In `apps/web`: `bun run test:web` (Vitest only) or `bun run test:go` (Go tests only).

- **`packages/contracts`** — Zod schemas, slot/timezone/options logic (node env).
- **`apps/web`** — helpers, API client, client error classification + link builders, React hooks, components (happy-dom env); Go unit tests in `pkg/` (`go test ./pkg/...`). Config in `vitest.config.ts`; `server-only` stubbed via `vitest.server-only-stub.ts`; RTL cleanup in `vitest.setup.ts`.

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
- Capacity updates atomic; bookings only `confirmed` | `cancelled`.
- Prices are display text only in MVP (no payments).
- Optional display `location` and `contact` on `Organizer` and `Service`; `Service.*` overrides the organizer's — [domain](docs/domain.md).
- Read-only **demo organizer** seeded at `/demo`; identity is `DEMO_ORGANIZER_ID` in `packages/contracts`. Every write path must reject it, including guest booking + cancel, and notifications must never be sent for it — [ADR-010](docs/decisions/010-demo-organizer-account.md). The seed is refreshed daily by a QStash schedule, kept in sync by CI (`apps/web/scripts/ensure-qstash.ts`).
- **`/cabinet` requires no session:** anonymous visitors get the read-only demo cabinet, signed-in organizers get their own. Scope every cabinet read through `resolveCabinetOrganizerId()` and guard every write server-side. `/cabinet/*` is `noindex` — [ADR-010](docs/decisions/010-demo-organizer-account.md).
- Guest identity is a **consumed** auth ticket, never a client-supplied `messengerId`. `RequireGuestIdentity()` in the Go API (`apps/web/pkg/httpx`) is the only way it enters a write; single-use, so a replayed booking fails.
- **Notifications are published to QStash after the booking/cancel transaction commits** (ADR-012), via the Go publisher (`apps/web/pkg/queue`), inline after the DB commit (no `after()` on the Go runtime). The publisher absorbs its own errors — a notification must never fail a committed booking. Queue names and payloads in `packages/contracts/src/jobs.ts`; jobs carry **ids only**, and the handler refetches at send time. `booking.created` fans out to one job **per recipient**.
- **QStash deliveries arrive at `POST /api/jobs/{queue}`** (Go: `apps/web/pkg/routes/jobs.go`, routed via the single `apps/web/api/entry/index.go` + `vercel.json` rewrite): verify `upstash-signature` before anything else; `500` makes QStash retry, `400`/`404` do not, and dispatch lives in `apps/web/pkg/jobs/run.go`.
- **Organizer deep links are one-time login links.** The notification job mints `{ organizerId, next }` into Redis (`issueLoginLink` in `src/server/auth/login-link.ts`) and links to `/login/link/{token}`, consumed on **`POST`** (never `GET` — previewers fetch URLs before a human clicks). Single-use, `noindex`, demo id refused.
- A Telegram bot may only message users who pressed **Start**: unreachable recipient (`403`, `chat not found`) completes the delivery with a log instead of retrying — only `429`/`5xx`/network are retried.
- `manageToken` is the guest's credential for `/booking/{manageToken}`: generated server-side in the Go API, returned only in `GuestBooking` DTO, passed in **request body** on cancel to stay out of logs and `Referer` headers. The TS `server/db/booking.ts` reads it for the guest management page but does not generate it.
- Seats move only through atomic reserve — a single conditional `UPDATE … WHERE bookedCount + :seats <= capacity` inside the booking transaction. Never read `bookedCount`, check in JS, then write back.
- **i18n (ADR-011):** locale = cookie `NEXT_LOCALE` → `Accept-Language` → `en`, never in URL. Supported set: `LOCALES` (`packages/contracts/src/i18n.ts`); copy in `packages/translations` (`messages/` web, `notifications/` job handlers; en defines the shape). Server `getTranslations`, client `useTranslations`; no hardcoded user-visible strings — ESLint rule `countmein/no-untranslated-strings` enforces it. API errors: `getTranslations('ApiErrors')` in route handlers (error classes keep EN messages for logs); api-client fallbacks are named English constants (documented as such), the display site translates server copy. Job-handler responses carry no body (QStash reads status codes). Notifications: organizer `organizers.language`, guest `bookings.guest_locale`. Times always in the organizer's timezone.
- **Component props are `type`, never `interface`** (declarations named `*Props`; enforced via `no-restricted-syntax` in `apps/web/eslint.config.js`). Other object shapes are the author's choice; in ambient declarations (`**/*.d.ts`) `interface` is the norm — declaration merging there requires it.
- Response DTOs use shape primitives; only request schemas carry policy refinements (reserved slugs, uniqueness) — a response must never fail its own schema ([ADR-015](docs/decisions/015-api-route-manifest.md)).
- Do not expand scope without ADR/roadmap update.
