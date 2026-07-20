# Architecture

High-level system design for CountMeIn. Product domain lives in [domain.md](domain.md); decisions in [decisions/](decisions/).

## Product surfaces

| Surface | App | Audience | Responsibility |
|---------|-----|----------|----------------|
| Landing | `apps/web` | Prospects | Marketing, organizer sign-up |
| Public booking | `apps/web` | Guests | `https://countmein.group/{orgSlug}` — service → slot → options → book |
| Organizer cabinet | `apps/web` | Organizers | Services, slots, bookings, profile/media — opened from messenger links |
| API | `apps/web` (Route Handlers) | Clients | HTTP API; Auth.js for organizers |
| Worker | `apps/worker` | — | Messenger notifications / jobs |

**MVP entry for organizers:** register via phone → OTP in messenger → later, each booking notification includes a link that opens the cabinet in the messenger WebView (or browser). No separate native app in MVP — [ADR-006](decisions/006-organizer-capacitor.md).

## Context diagram

```mermaid
flowchart LR
  Landing[apps/web Landing]
  Public[apps/web Public booking]
  Cabinet[apps/web Organizer cabinet]
  Messenger[Messenger WebView]
  API[apps/web API]
  Worker[apps/worker]
  DB[(Postgres)]
  Redis[(Redis)]
  R2[(Cloudflare R2)]
  MQ[pg-boss]

  Landing --> API
  Public --> API
  Cabinet --> API
  Messenger -->|"deep link"| Cabinet
  Worker -->|"notify + cabinet URL"| Messenger
  API --> DB
  API --> Redis
  API --> R2
  API --> MQ
  MQ --> Worker
  Worker --> DB
```

## Component roles

| Component | Role |
|-----------|------|
| `apps/web` | Next.js: landing, public booking, organizer cabinet, HTTP API, Auth.js |
| `apps/worker` | Jobs: messenger notifications with cabinet deep links (Telegram first) |
| `packages/db` | Drizzle schema, migrations, client |
| `packages/api-contracts` | Zod schemas shared by web and worker |
| `packages/ui` | Optional shared shadcn primitives |
| `packages/storage` | R2 signed upload helpers |
| `packages/eslint-config` / `packages/typescript-config` | Shared lint & TS configs |
| Postgres | Domain + `pg-boss` |
| Redis | Sessions, OTP TTL, rate limits |
| Cloudflare R2 | Organizer avatar + service images ([ADR-007](decisions/007-cloudflare-r2.md)) |

## Critical flow: create booking (guest)

1. `GET` public page data by organizer `slug` (services, slots; cacheable).
2. Guest picks service/slot/options; enters name + phone; messenger OTP verifies phone (Redis TTL; **no seat held**).
3. `POST` booking in one transaction (after OTP):
   - validate `selectedOptions` against service
   - assert `bookedCount + seats <= capacity`
   - insert `Booking` (`confirmed`)
   - increment `bookedCount`
4. Enqueue `booking.created` (cancel token for guest; **cabinet URL** for organizer).
5. Worker notifies guest + organizer; organizer message includes link to cabinet / booking.
6. Invalidate TanStack Query on the public page (and cabinet if open).

If the slot filled during OTP, step 3 fails; guest picks another slot. No `pending` status.

### Cancel (MVP)

Guest token from messenger, or organizer in the web cabinet. Transaction: `cancelled` + decrement `bookedCount` + enqueue `booking.cancelled`.

### Media upload (organizer)

Authenticated organizer in cabinet → signed upload URL → PUT to R2 → save URL on `photoUrl`.

## Auth boundary

- **Organizers:** Auth.js (phone + messenger OTP); session for cabinet routes. Deep links should land in an authenticated session (cookie after login, or one-time link that establishes session). See [ADR-005](decisions/005-phone-messenger.md).
- **Visitors:** No Auth.js account; phone + OTP / cancel token. See [ADR-002](decisions/002-guest-booking.md).

## Monorepo

[ADR-001](decisions/001-monorepo-layout.md) · organizer client [ADR-006](decisions/006-organizer-capacitor.md) · storage [ADR-007](decisions/007-cloudflare-r2.md).

## Jobs / notifications

`pg-boss` + `apps/worker`; messengers primary ([ADR-005](decisions/005-phone-messenger.md), [ADR-004](decisions/004-queue-pg-boss.md)).

## Out of scope for this document

- Concrete DDL (Drizzle later).
- Deployment topology and CI details.
- Payment processing, multi-staff, subdomain tenancy, Capacitor app ([roadmap.md](roadmap.md)).
