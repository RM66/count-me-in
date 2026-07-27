# CountMeIn — Agent Guide

Simple online booking for group events: organizers publish services with time slots and capacity; guests book on a public web page; organizers manage a web cabinet opened from messenger notification links.

**Host:** `https://countmein.group` — public booking at `/{orgSlug}`.

## Stack

- **Runtime / monorepo:** Bun, Turborepo
- **App:** Next.js (`apps/web`) — landing, public booking, organizer cabinet, API
- **UI:** React, Tailwind, shadcn/ui (Radix)
- **State:** TanStack Query (server), Zustand (local UI)
- **Auth:** Auth.js — organizers via phone + messenger OTP (`Organizer.id` = user id)
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
    proxy.ts           # Auth.js v5 proxy (cabinet routes)
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
- `services/` — Server-side logic (auth, redis, otp/, booking/, storage/)
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
- Phone + messenger — [ADR-005](docs/decisions/005-phone-messenger.md).
- Guest booking without Auth.js accounts; cancel in MVP — [ADR-002](docs/decisions/002-guest-booking.md).
- Capacity updates atomic; bookings only `confirmed` | `cancelled`.
- Prices are display text only in MVP (no payments).
- Optional display `location` on `Organizer` and `Service`; `Service.location` overrides the organizer's, shown on public pages and passed to `add-to-calendar` — [domain](docs/domain.md).
- Do not expand scope without ADR/roadmap update.
