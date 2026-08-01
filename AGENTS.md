# CountMeIn — Agent Guide

Simple online booking for group events: organizers publish services with time slots and capacity; guests book on a public web page; organizers manage a web cabinet opened from messenger notification links.

**Host:** `https://countmein.group` — public booking at `/{orgSlug}` (min 4 chars, reserved: `api`, `booking`, `cabinet`, `signup`, `login`, `terms`, `privacy`, `demo`).

## Stack

- **Runtime / monorepo:** Bun, Turborepo
- **App:** Next.js (`apps/web`) — landing, public booking, organizer cabinet, API
- **UI:** React, Tailwind, shadcn/ui (Radix)
- **State:** TanStack Query (server), Zustand (local UI)
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
  worker/              # notifications / jobs
packages/
  db/                  # Drizzle schema, migrations
  api-contracts/       # Zod schemas, shared types
  storage/             # Cloudflare R2 helpers
  eslint-config/       # shared ESLint
  typescript-config/   # shared tsconfig
docs/
```

**Root of `apps/web/` — two kinds of file, only one of them ours.** Everything we
organise lives under `lib/`, `hooks/`, `components/`, `types/`. What remains at
the root is discovered _by convention_ and its path is load-bearing: `app/`,
`proxy.ts`, `next.config.js`, `postcss.config.mjs`, `tsconfig.json`,
`eslint.config.js`, `components.json`, `next-env.d.ts`.

`proxy.ts` is the sharp edge — it is Next 16's rename of `middleware.ts`, found
only at the project root, with **no config option pointing at it**. Move it into
`lib/` and the build still passes while shipping **no middleware at all** (the
`ƒ Proxy (Middleware)` line vanishes from the build output and signed-in
organizers stop being redirected off `/login` and `/signup`). Contrast
`lib/utils.ts`, which _was_ movable precisely because `components.json` holds an
alias that can be repointed: if a root file has a config knob, it can move; if it
does not, it cannot.

**`apps/web/lib/` structure:**

- `api/` — **client-only** React Query layer, one file per entity
  (`organizer.ts`, `service.ts`, `auth.ts`), each holding that entity's queries
  _and_ mutations. `keys.ts` is the cache-key factory, `client.ts` the
  fetch helpers, `image.ts` browser-side downscaling. Import via `@/lib/api`.
- `server/` — **server-only** code; every module carries `import 'server-only'`
  - `auth/` — Auth.js config (`index.ts`), signup tickets (`ticket.ts`), `telegram-provider.ts`
  - `db/` — Postgres reads **and writes** + DTO mapping, one file per entity
    (`organizer.ts`, `service.ts`); `shared.ts` holds `pickDefined`. Route
    handlers must not run SQL inline — a mutation that lives in `route.ts`
    cannot be reused by the worker or tested without HTTP.
  - `http.ts` — route-handler plumbing: `requireWritableOrganizer()` (session +
    demo guard) and `parseJsonBody()` (Zod + `400`). Both return a
    `Guarded<T>` discriminated union — check `.ok`, never truthiness.
  - `storage/` — Cloudflare R2 orchestration (avatar, service-photo, media ownership)
  - `demo.ts`, `redis.ts` — cross-cutting policy guard / infra singleton
- `helpers/` — pure presentation utilities: formatting and adapters
  (date.ts, name.ts, contact.ts).
- `constants/` — static data tables (timezones.ts).
- `utils.ts` — `cn()` only. **Shadcn-owned, and deliberately not in `helpers/`:**
  the path is the `utils` alias in `components.json`, so the CLI writes
  `import { cn } from '@/lib/utils'` into every component it generates. Moving or
  renaming it means editing that alias in the same commit, or the next
  `shadcn add` emits a broken import. Do not add non-shadcn helpers here.

There is **no `lib/domain/`**. It was deleted 2026-08-01 as dead code — nothing
imported it. Entity invariants live in the layer that enforces them
(`lib/server/db/` for persistence) or in `packages/api-contracts` when both
client and server need them. The slot calculations (`seatsLeft`, `fillLabel`,
`slotEnd`, `slotPrice`) and the location/contact override (`effectiveLocation`,
`effectiveContact`) moved there 2026-08-01; `lib/mock-data.ts` now only re-binds
them to the mock organizer. Never add a new app-local rules layer — see
[ADR-001](docs/decisions/001-monorepo-layout.md).

**Wall-clock time is a contract, not a formatting detail.** A slot is stored as
an instant (`timestamptz`) but authored as "the 25th at 07:00" in the
organizer's timezone. `new Date('2026-07-25T07:00')` parses in the _runtime's_
zone, so the browser and the server would disagree by hours. Both directions
live in `packages/api-contracts/src/timezone.ts` (`wallClockToInstant`,
`instantToWallClockInputs`) precisely because the form, the API and the worker
must agree; `helpers/date.ts` stays purely about rendering an instant that
already exists.

**Form schemas are not wire schemas.** A controlled input holds a `string`
(including `''` mid-edit), while the API takes numbers and reads `null` as
"clear this column". Each entity therefore has a `*-form.ts` beside its wire
schema (`service-form.ts`, `time-slot-form.ts`) that validates the input shape
and transforms it into the wire shape, with the two adapters that bridge the gap
(`optionalText`, `numericText`) shared from `form-fields.ts`. Bounds always
compose from `primitives.ts`, so client and server rules cannot drift.

**Naming rule — `service` is ambiguous, so the layer never uses it.** `Service`
(услуга) is a domain entity: the `services` table, `/api/services`,
`/cabinet/services`, `ServiceRecord`. The server layer is therefore called
`server/`, not `services/`, and entity files live at `lib/server/db/service.ts`
(layer → kind → entity). Never reintroduce a `lib/services/` directory.

**`app/api/` vs `lib/api/` — two ends of one wire, not a duplication.**
`app/api/**/route.ts` is a framework-owned path: the directory _is_ the URL, and
it holds the server handlers. `lib/api/` is the browser client that calls those
URLs. They never import each other — the only contract between them is the HTTP
route plus the Zod schemas in `packages/api-contracts`.

**What belongs in `helpers/`:** a _rendering_ — it turns a value into something
displayable and would be pointless without a UI (`detectContactKind` →
`tel:`/`mailto:` href; `formatDate`). A static table is `constants/` instead.
A _rule_ traceable to [domain.md](docs/domain.md) (which value wins, an
invariant) does **not** go here: put it in the layer that enforces it, or in
`packages/api-contracts` when both client and server need it.

**Query keys live in `lib/api/keys.ts`.** Never write a `queryKey` array literal
inline: a mutation and the query it invalidates must resolve the same key, and
duplicated literals are how invalidation silently breaks. Keys are hierarchical,
so `queryKeys.services.all` invalidates every service query beneath it.

See [ADR-001](docs/decisions/001-monorepo-layout.md), [ADR-007](docs/decisions/007-cloudflare-r2.md).

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
- Optional display `location` on `Organizer` and `Service`; `Service.location` overrides the organizer's, shown on public pages and passed to `add-to-calendar` — [domain](docs/domain.md).
- Optional display `contact` on `Organizer` and `Service` (same override rule); stored as one plain string, rendered via `detectContactKind` + `<ContactLink />` (tel:/mailto:/https:/plain) — [domain](docs/domain.md).
- Read-only **demo organizer** seeded at `/demo`; identity is a code constant (`DEMO_ORGANIZER_ID` in `packages/api-contracts`), not a DB flag. Every write path must reject it (`rejectDemoWrite` / `assertNotDemo` in `apps/web/lib/server/demo.ts`), including guest booking + cancel, and the worker must not notify it — [ADR-010](docs/decisions/010-demo-organizer-account.md).
- **`/cabinet` requires no session:** anonymous visitors get the read-only demo cabinet, signed-in organizers get their own. There is no demo session/cookie — "demo" is resolved per request via `resolveCabinetOrganizerId()`. Consequence: a cabinet route does **not** imply an authenticated organizer, so scope every cabinet read through that helper and guard every write server-side. `/cabinet/*` is `noindex` — [ADR-010](docs/decisions/010-demo-organizer-account.md).
- `apps/web/lib/mock-data.ts` is temporary scaffolding for pages not yet wired to the API; drop each import as its endpoint lands, and delete the file once the last one goes. It holds **fixtures only** — the domain rules it used to own now live in `packages/api-contracts`, so nothing of value dies with it. It is **not** the demo data source — that is the DB seed in `packages/db/src/seed/`.
- Do not expand scope without ADR/roadmap update.
