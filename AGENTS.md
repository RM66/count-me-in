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
- **Media:** Cloudflare R2 (`packages/media-storage`)
- **Jobs:** `pg-boss` + `apps/worker`
- **Notifications:** messengers primary (Telegram first); cabinet deep links in messages
- **Observability:** PostHog, Sentry

No separate organizer native app in MVP — [ADR-006](docs/decisions/006-organizer-capacitor.md). WebSockets out of MVP — [ADR-003](docs/decisions/003-no-websocket-mvp.md).

## Monorepo layout

```
apps/
  web/                 # Next.js: landing + public booking + cabinet + API
    src/               # All app source lives under src/ (Next.js src/ convention)
      app/             # App Router: pages, layouts, route handlers
      components/      # React components (shadcn/ui + app components)
      hooks/           # React hooks (shadcn-owned alias `@/hooks`)
      server/          # server-only: db, auth, storage, queue, demo (import 'server-only')
      api-client/      # client-only React Query layer — the browser end of the wire
      helpers/         # pure presentation utilities (date, name, contact)
      constants/       # static data tables (timezones, site)
      lib/             # cross-cutting singletons: posthog.ts, og/, utils.ts (cn)
      types/           # TypeScript utility types
      proxy.ts         # Auth.js v5 middleware — src/ root, do not move
      instrumentation.ts # Sentry server-side init
    public/            # Static assets
  worker/              # notifications / jobs: pg-boss consumer, Telegram sender
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

- `server/` — **server-only** code; every module carries `import 'server-only'`. The server end of the wire.
  - `auth/` — Auth.js config (`index.ts`), signup tickets (`ticket.ts`), `telegram-provider.ts`
  - `db/` — Postgres reads **and writes** + DTO mapping, one file per entity (`organizer.ts`, `service.ts`); `shared.ts` holds `pickDefined`. Route handlers must not run SQL inline.
  - `http.ts` — route-handler plumbing: `requireWritableOrganizer()` (session + demo guard), `requireGuestIdentity()` (consumes an auth ticket) and `parseJsonBody()` (Zod + `400`). All return a `Guarded<T>` discriminated union — check `.ok`, never truthiness. **Request-level only: must not import from `db/`.**
  - `storage/` — Cloudflare R2 orchestration (avatar, service-photo, media ownership)
  - `demo.ts`, `queue.ts` — cross-cutting policy guard / job publisher
- `api-client/` — **client-only** React Query layer, one file per entity (`organizer.ts`, `service.ts`, `auth.ts`), each holding queries _and_ mutations. `keys.ts` is the cache-key factory, `client.ts` the fetch helpers, `image.ts` browser-side downscaling. Import via `@/api-client`. The browser end of the wire.
- `helpers/` — pure presentation utilities: formatting and adapters (`date.ts`, `name.ts`, `contact.ts`).
- `constants/` — static data tables (`timezones.ts`, `site.ts`).
- `lib/` — cross-cutting singletons that don't fit a semantic bucket: `posthog.ts` (analytics), `og/` (OpenGraph image assets), `utils.ts` (`cn()`). **`utils.ts` is shadcn-owned:** path is the `utils` alias in `components.json`. Do not add non-shadcn helpers here.

**No `lib/domain/`** — deleted as dead code. Entity invariants live in `server/db/` or `packages/contracts` when both client and server need them. Slot calculations (`seatsLeft`, `fillLabel`, `slotEnd`, `slotPrice`) and location/contact override (`effectiveLocation`, `effectiveContact`) live in `@repo/contracts`. Never add a new app-local rules layer — see [ADR-001](docs/decisions/001-monorepo-layout.md).

**No mock data** — `lib/mock-data.ts` was deleted. Sample content is the **demo seed** (`packages/db/src/seed/`), real rows behind `/demo` (ADR-010). Do not reintroduce fixtures.

**Wall-clock time is a contract.** A slot is stored as `timestamptz` but authored in the organizer's timezone. Both directions live in `packages/contracts/src/timezone.ts` (`wallClockToInstant`, `instantToWallClockInputs`); `helpers/date.ts` stays purely about rendering an instant that already exists.

**Form schemas are not wire schemas.** Controlled inputs hold `string` (including `''` mid-edit), while the API takes numbers and `null`. Each entity has a `*-form.ts` beside its wire schema, with adapters (`optionalText`, `numericText`) shared from `form-fields.ts`. Bounds compose from `primitives.ts`.

**Naming rule — `service` is ambiguous.** The server layer is called `server/`, not `services/`, and entity files live at `server/db/service.ts` (kind → entity). Never reintroduce `services/`.

**`app/api/` vs `api-client/`** — two ends of one wire. `app/api/**/route.ts` is the URL and holds server handlers. `api-client/` is the browser client. They never import each other — contract is HTTP + Zod schemas in `packages/contracts`.

**What belongs in `helpers/`:** a _rendering_ — turns a value into something displayable (`detectContactKind`, `formatDate`). A static table is `constants/`. A _rule_ traceable to [domain.md](docs/domain.md) goes in the layer that enforces it or in `packages/contracts`.

**Query keys live in `api-client/keys.ts`.** Never write a `queryKey` array literal inline — duplicated literals break invalidation silently. Keys are hierarchical, so `queryKeys.services.all` invalidates every service query beneath it.

See [ADR-001](docs/decisions/001-monorepo-layout.md), [ADR-007](docs/decisions/007-cloudflare-r2.md).

## Testing

**Vitest** is the test runner; **React Testing Library** covers components and hooks. Tests are **co-located** (`*.test.ts` / `*.test.tsx` beside source). Run all tests via the Turborepo pipeline:

```sh
bun run test          # all packages
bun run test:watch    # watch mode
```

Per-package: `cd <package> && bun run test`.

- **`packages/contracts`** — Zod schemas, slot/timezone/options logic (node env).
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
- Read-only **demo organizer** seeded at `/demo`; identity is `DEMO_ORGANIZER_ID` in `packages/contracts`. Every write path must reject it, including guest booking + cancel, and the worker must not notify it — [ADR-010](docs/decisions/010-demo-organizer-account.md).
- **`/cabinet` requires no session:** anonymous visitors get the read-only demo cabinet, signed-in organizers get their own. Scope every cabinet read through `resolveCabinetOrganizerId()` and guard every write server-side. `/cabinet/*` is `noindex` — [ADR-010](docs/decisions/010-demo-organizer-account.md).
- Guest identity is a **consumed** auth ticket, never a client-supplied `messengerId`. `requireGuestIdentity()` in `apps/web/src/server/http.ts` is the only way it enters a write; single-use, so a replayed booking fails.
- **Notifications are enqueued inside the booking/cancel transaction**, via `enqueueBookingCreated` / `enqueueBookingCancelled` in `apps/web/src/server/queue.ts` (pg-boss `fromDrizzle` over the caller's `tx`). Queue names and payloads in `packages/contracts/src/jobs.ts`; jobs carry **ids only**, and `apps/worker` refetches at send time. `booking.created` fans out to one job **per recipient**.
- **Organizer deep links are one-time login links.** The worker mints `{ organizerId, next }` into Redis and links to `/login/link/{token}`, consumed on **`POST`** (never `GET` — previewers fetch URLs before a human clicks). Single-use, `noindex`, demo id refused.
- A Telegram bot may only message users who pressed **Start**: unreachable recipient (`403`, `chat not found`) completes the job with a log instead of retrying — only `429`/`5xx`/network are retried.
- `manageToken` is the guest's credential for `/booking/{manageToken}`: generated server-side in `src/server/db/booking.ts`, returned only in `GuestBooking` DTO, passed in **request body** on cancel to stay out of logs and `Referer` headers.
- Seats move only through atomic reserve — a single conditional `UPDATE … WHERE bookedCount + :seats <= capacity` inside the booking transaction. Never read `bookedCount`, check in JS, then write back.
- **i18n (ADR-011):** locale = cookie `NEXT_LOCALE` → `Accept-Language` → `en`, never in URL. Supported set: `LOCALES` (`packages/contracts/src/i18n.ts`); copy in `packages/translations` (`messages/` web, `notifications/` worker; en defines the shape). Server `getTranslations`, client `useTranslations`; no hardcoded user-visible strings — ESLint rule `countmein/no-untranslated-strings` enforces it. API errors: `getTranslations('ApiErrors')` in route handlers (error classes keep EN messages for logs); api-client fallbacks are named English constants (documented as such), the display site translates server copy. Notifications: organizer `organizers.language`, guest `bookings.guest_locale`. Times always in the organizer's timezone.
- Do not expand scope without ADR/roadmap update.
