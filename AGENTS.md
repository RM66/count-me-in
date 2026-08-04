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
- **Validation:** Zod (`packages/api-contracts`)
- **Data:** Postgres, Drizzle ORM, Redis
- **Media:** Cloudflare R2 (`packages/storage`)
- **Jobs:** `pg-boss` + `apps/worker`
- **Notifications:** messengers primary (Telegram first); cabinet deep links in messages
- **Observability:** PostHog, Sentry

No separate organizer native app in MVP — [ADR-006](docs/decisions/006-organizer-capacitor.md). WebSockets out of MVP — [ADR-003](docs/decisions/003-no-websocket-mvp.md).

## Monorepo layout

```
apps/
  web/                 # Next.js: landing + public booking + cabinet + API
    lib/               # Business logic (api, server, helpers, constants) + utils.ts (cn)
    hooks/             # React hooks (shadcn-owned alias `@/hooks`)
    types/             # TypeScript utility types
    proxy.ts           # Auth.js v5 middleware — root location required, do not move
  worker/              # notifications / jobs: pg-boss consumer, Telegram sender
packages/
  db/                  # Drizzle schema, migrations
  redis/               # ioredis singleton (tickets, login links, rate limits)
  api-contracts/       # Zod schemas, shared types
  storage/             # Cloudflare R2 helpers
  eslint-config/       # shared ESLint
  typescript-config/   # shared tsconfig
docs/
```

**Root of `apps/web/` — two kinds of file, only one of them ours.** Everything we organise lives under `lib/`, `hooks/`, `components/`, `types/`. What remains at the root is discovered _by convention_ and its path is load-bearing: `app/`, `proxy.ts`, `next.config.js`, `postcss.config.mjs`, `tsconfig.json`, `eslint.config.js`, `components.json`, `next-env.d.ts`.

`proxy.ts` is Next 16's rename of `middleware.ts`, found only at the project root with **no config option pointing at it**. Moving it breaks auth silently — the `ƒ Proxy (Middleware)` line vanishes from build output and signed-in organizers stop being redirected off `/login` and `/signup`. Contrast `lib/utils.ts`, which _was_ movable because `components.json` holds an alias that can be repointed.

**`apps/web/lib/` structure:**

- `api/` — **client-only** React Query layer, one file per entity (`organizer.ts`, `service.ts`, `auth.ts`), each holding queries _and_ mutations. `keys.ts` is the cache-key factory, `client.ts` the fetch helpers, `image.ts` browser-side downscaling. Import via `@/lib/api`.
- `server/` — **server-only** code; every module carries `import 'server-only'`
  - `auth/` — Auth.js config (`index.ts`), signup tickets (`ticket.ts`), `telegram-provider.ts`
  - `db/` — Postgres reads **and writes** + DTO mapping, one file per entity (`organizer.ts`, `service.ts`); `shared.ts` holds `pickDefined`. Route handlers must not run SQL inline.
  - `http.ts` — route-handler plumbing: `requireWritableOrganizer()` (session + demo guard), `requireGuestIdentity()` (consumes an auth ticket) and `parseJsonBody()` (Zod + `400`). All return a `Guarded<T>` discriminated union — check `.ok`, never truthiness. **Request-level only: must not import from `db/`.**
  - `storage/` — Cloudflare R2 orchestration (avatar, service-photo, media ownership)
  - `demo.ts`, `queue.ts` — cross-cutting policy guard / job publisher
- `helpers/` — pure presentation utilities: formatting and adapters (`date.ts`, `name.ts`, `contact.ts`).
- `constants/` — static data tables (`timezones.ts`).
- `utils.ts` — `cn()` only. **Shadcn-owned:** path is the `utils` alias in `components.json`. Do not add non-shadcn helpers here.

**No `lib/domain/`** — deleted as dead code. Entity invariants live in `lib/server/db/` or `packages/api-contracts` when both client and server need them. Slot calculations (`seatsLeft`, `fillLabel`, `slotEnd`, `slotPrice`) and location/contact override (`effectiveLocation`, `effectiveContact`) live in `@repo/api-contracts`. Never add a new app-local rules layer — see [ADR-001](docs/decisions/001-monorepo-layout.md).

**No mock data** — `lib/mock-data.ts` was deleted. Sample content is the **demo seed** (`packages/db/src/seed/`), real rows behind `/demo` (ADR-010). Do not reintroduce fixtures.

**Wall-clock time is a contract.** A slot is stored as `timestamptz` but authored in the organizer's timezone. Both directions live in `packages/api-contracts/src/timezone.ts` (`wallClockToInstant`, `instantToWallClockInputs`); `helpers/date.ts` stays purely about rendering an instant that already exists.

**Form schemas are not wire schemas.** Controlled inputs hold `string` (including `''` mid-edit), while the API takes numbers and `null`. Each entity has a `*-form.ts` beside its wire schema, with adapters (`optionalText`, `numericText`) shared from `form-fields.ts`. Bounds compose from `primitives.ts`.

**Naming rule — `service` is ambiguous.** The server layer is called `server/`, not `services/`, and entity files live at `lib/server/db/service.ts` (layer → kind → entity). Never reintroduce `lib/services/`.

**`app/api/` vs `lib/api/`** — two ends of one wire. `app/api/**/route.ts` is the URL and holds server handlers. `lib/api/` is the browser client. They never import each other — contract is HTTP + Zod schemas in `packages/api-contracts`.

**What belongs in `helpers/`:** a _rendering_ — turns a value into something displayable (`detectContactKind`, `formatDate`). A static table is `constants/`. A _rule_ traceable to [domain.md](docs/domain.md) goes in the layer that enforces it or in `packages/api-contracts`.

**Query keys live in `lib/api/keys.ts`.** Never write a `queryKey` array literal inline — duplicated literals break invalidation silently. Keys are hierarchical, so `queryKeys.services.all` invalidates every service query beneath it.

See [ADR-001](docs/decisions/001-monorepo-layout.md), [ADR-007](docs/decisions/007-cloudflare-r2.md).

## Testing

**Vitest** is the test runner; **React Testing Library** covers components and hooks. Tests are **co-located** (`*.test.ts` / `*.test.tsx` beside source). Run all tests via the Turborepo pipeline:

```sh
bun run test          # all packages
bun run test:watch    # watch mode
```

Per-package: `cd <package> && bun run test`.

- **`packages/api-contracts`** — Zod schemas, slot/timezone/options logic (node env).
- **`apps/web`** — helpers, API client, server guards, React hooks, components (happy-dom env). Config in `vitest.config.ts`; `server-only` stubbed via `vitest.server-only-stub.ts`; RTL cleanup in `vitest.setup.ts`.
- **`apps/worker`** — Telegram templates, client error classification, link builders (node env).

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
- Read-only **demo organizer** seeded at `/demo`; identity is `DEMO_ORGANIZER_ID` in `packages/api-contracts`. Every write path must reject it, including guest booking + cancel, and the worker must not notify it — [ADR-010](docs/decisions/010-demo-organizer-account.md).
- **`/cabinet` requires no session:** anonymous visitors get the read-only demo cabinet, signed-in organizers get their own. Scope every cabinet read through `resolveCabinetOrganizerId()` and guard every write server-side. `/cabinet/*` is `noindex` — [ADR-010](docs/decisions/010-demo-organizer-account.md).
- Guest identity is a **consumed** auth ticket, never a client-supplied `messengerId`. `requireGuestIdentity()` in `apps/web/lib/server/http.ts` is the only way it enters a write; single-use, so a replayed booking fails.
- **Notifications are enqueued inside the booking/cancel transaction**, via `enqueueBookingCreated` / `enqueueBookingCancelled` in `apps/web/lib/server/queue.ts` (pg-boss `fromDrizzle` over the caller's `tx`). Queue names and payloads in `packages/api-contracts/src/jobs.ts`; jobs carry **ids only**, and `apps/worker` refetches at send time. `booking.created` fans out to one job **per recipient**.
- **Organizer deep links are one-time login links.** The worker mints `{ organizerId, next }` into Redis and links to `/login/link/{token}`, consumed on **`POST`** (never `GET` — previewers fetch URLs before a human clicks). Single-use, `noindex`, demo id refused.
- A Telegram bot may only message users who pressed **Start**: unreachable recipient (`403`, `chat not found`) completes the job with a log instead of retrying — only `429`/`5xx`/network are retried.
- `manageToken` is the guest's credential for `/booking/{manageToken}`: generated server-side in `lib/server/db/booking.ts`, returned only in `GuestBooking` DTO, passed in **request body** on cancel to stay out of logs and `Referer` headers.
- Seats move only through atomic reserve — a single conditional `UPDATE … WHERE bookedCount + :seats <= capacity` inside the booking transaction. Never read `bookedCount`, check in JS, then write back.
- Do not expand scope without ADR/roadmap update.
