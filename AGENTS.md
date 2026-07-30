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
    lib/               # Business logic (api, services, domain, helpers)
    types/             # TypeScript utility types
    utils.ts           # UI utilities (cn)
    proxy.ts           # Auth.js v5 proxy (auth pages only — /cabinet is public)
  worker/              # notifications / jobs
packages/
  db/                  # Drizzle schema, migrations
  api-contracts/       # Zod schemas, shared types
  storage/             # Cloudflare R2 helpers
  eslint-config/       # shared ESLint
  typescript-config/   # shared tsconfig
docs/
```

**`apps/web/lib/` structure:**

- `api/` — React Query hooks (mutations/, queries/, client.ts, error.ts)
- `services/` — Server-side logic (auth, redis, booking/, storage/)
- `domain/` — Pure business logic (slot.ts, etc.)
- `helpers/` — Utilities (date.ts, etc.)

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
- Read-only **demo organizer** seeded at `/demo`; identity is a code constant (`DEMO_ORGANIZER_ID` in `packages/api-contracts`), not a DB flag. Every write path must reject it (`rejectDemoWrite` / `assertNotDemo` in `apps/web/lib/services/demo.ts`), including guest booking + cancel, and the worker must not notify it — [ADR-010](docs/decisions/010-demo-organizer-account.md).
- **`/cabinet` requires no session:** anonymous visitors get the read-only demo cabinet, signed-in organizers get their own. There is no demo session/cookie — "demo" is resolved per request via `resolveCabinetOrganizerId()`. Consequence: a cabinet route does **not** imply an authenticated organizer, so scope every cabinet read through that helper and guard every write server-side. `/cabinet/*` is `noindex` — [ADR-010](docs/decisions/010-demo-organizer-account.md).
- `apps/web/lib/mock-data.ts` is temporary scaffolding for pages not yet wired to the API; drop each import as its endpoint lands. It is **not** the demo data source — that is the DB seed in `packages/db/src/seed/`.
- Do not expand scope without ADR/roadmap update.
