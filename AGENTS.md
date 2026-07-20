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

## Monorepo layout (target)

```
apps/
  web/                 # Next.js: landing + public booking + cabinet + API
  worker/              # notifications / jobs
packages/
  db/                  # Drizzle
  api-contracts/       # Zod / shared types
  ui/                  # shared UI
  storage/             # Cloudflare R2
  eslint-config/       # shared ESLint (turbo starter)
  typescript-config/   # shared tsconfig (turbo starter)
docs/
```

See [ADR-001](docs/decisions/001-monorepo-layout.md), [ADR-007](docs/decisions/007-cloudflare-r2.md).

## Documentation

| Doc | Purpose |
|-----|---------|
| [docs/architecture.md](docs/architecture.md) | Surfaces, data flow, infra |
| [docs/domain.md](docs/domain.md) | Entities (no Calendar), invariants |
| [docs/roadmap.md](docs/roadmap.md) | MVP vs later |
| [docs/decisions/](docs/decisions/) | ADRs |

## Conventions

- No `Calendar` entity; timezone + profile on `Organizer` — [domain](docs/domain.md).
- Phone + messenger — [ADR-005](docs/decisions/005-phone-messenger.md).
- Guest booking without Auth.js accounts; cancel in MVP — [ADR-002](docs/decisions/002-guest-booking.md).
- Capacity updates atomic; bookings only `confirmed` | `cancelled`.
- Prices are display text only in MVP (no payments).
- Do not expand scope without ADR/roadmap update.
