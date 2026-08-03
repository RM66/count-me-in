# Architecture

High-level system design for CountMeIn. Product domain in [domain.md](domain.md); decisions in [decisions/](decisions/).

## Product surfaces

| Surface           | App                         | Audience   | Responsibility                                                   |
| ----------------- | --------------------------- | ---------- | ---------------------------------------------------------------- |
| Landing           | `apps/web`                  | Prospects  | Marketing, organizer sign-up                                     |
| Public booking    | `apps/web`                  | Guests     | `https://countmein.group/{orgSlug}` — service → slot → book      |
| Organizer cabinet | `apps/web`                  | Organizers | Services, slots, bookings, profile — opened from messenger links |
| API               | `apps/web` (Route Handlers) | Clients    | HTTP API; Auth.js for organizers                                 |
| Worker            | `apps/worker`               | —          | Messenger notifications / jobs                                   |

**MVP entry for organizers:** register via Telegram Login Widget → profile form → booking notifications include cabinet deep link. No native app — [ADR-006](decisions/006-organizer-capacitor.md).

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

| Component                                      | Role                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/web`                                     | Next.js: landing, public booking, cabinet, API, Auth.js                       |
| `apps/worker`                                  | Jobs: messenger notifications with cabinet deep links (Telegram first)        |
| `packages/db`                                  | Drizzle schema, migrations, client                                            |
| `packages/redis`                               | ioredis singleton (sessions, auth tickets, rate limits)                       |
| `packages/api-contracts`                       | Zod schemas shared by web and worker                                          |
| `packages/storage`                             | R2 signed upload helpers                                                      |
| `packages/eslint-config` / `typescript-config` | Shared lint & TS configs                                                      |
| Postgres                                       | Domain + `pg-boss`                                                            |
| Redis                                          | Sessions, short-lived auth tickets, rate limits                               |
| Cloudflare R2                                  | Organizer avatar + service images ([ADR-007](decisions/007-cloudflare-r2.md)) |

## Critical flow: create booking (guest)

1. `GET` public page data by organizer `slug` (services, slots; cacheable).
2. Guest picks service/slot/options; enters name; authenticates with messenger login widget — server validates signed payload and issues short-lived guest ticket (Redis TTL; **no seat held**).
3. `POST` booking in one transaction (with the ticket):
   - validate `selectedOptions` against service
   - **claim seats atomically**: `UPDATE TimeSlot SET bookedCount = bookedCount + :seats WHERE id = :id AND bookedCount + :seats <= capacity RETURNING …` (not read-then-write)
   - if no row updated → slot full → abort
   - insert `Booking` (`confirmed`)
4. Enqueue `booking.created` (management link for guest; cabinet URL for organizer).
5. Worker notifies guest + organizer.
6. Invalidate TanStack Query on public page (and cabinet if open).

If slot filled while authenticating, conditional `UPDATE` affects no row → abort. No `pending` status.

### Cancel (MVP)

Guests cancel on `/booking/{manageToken}` (deep link from messenger) or re-authenticate for booking lookup. Organizers cancel from cabinet. One transaction: set `cancelled` + decrement `bookedCount` + enqueue `booking.cancelled`.

### Media upload (organizer)

Authenticated organizer → signed upload URL → PUT to R2 → save URL on `photoUrl`.

## Auth boundary

- **Organizers:** Auth.js (Telegram Login Widget, server-side HMAC); session for cabinet. Notification deep links use **one-time login link**: worker stores `{ organizerId, next }` in Redis under 32-byte token → `/login/link/{token}` consumed via `POST` (server action calling `signIn`). `GET` does not consume — link previewers fetch URLs before human clicks. Single-use, 30-day TTL, `noindex`, demo id refused; failure → `/login`. See [ADR-008](decisions/008-messenger-only-auth.md).
- **Visitors:** No Auth.js account; booking requires widget auth (short-lived ticket); management via deep link or re-auth. See [ADR-002](decisions/002-guest-booking.md).

## Jobs / notifications

`pg-boss` + `apps/worker`; messengers primary ([ADR-008](decisions/008-messenger-only-auth.md), [ADR-004](decisions/004-queue-pg-boss.md)).

### Queues

| Queue               | Payload                      | Jobs per event                          |
| ------------------- | ---------------------------- | --------------------------------------- |
| `booking.created`   | `{ bookingId, recipient }`   | **Two** — one per recipient             |
| `booking.cancelled` | `{ bookingId, cancelledBy }` | One — counterparty only                 |
| `demo.refresh`      | —                            | Scheduled daily (`seedDemo()`, ADR-010) |

**One job per recipient** — a retry re-sends only to whoever failed. **Payloads carry ids only** — worker refetches at send time, so `manageToken` and login tokens never reach `pgboss.job`. Contracts in `packages/api-contracts/src/jobs.ts`.

**Enqueue inside the booking transaction** (`apps/web/lib/server/queue.ts`, pg-boss `fromDrizzle` over caller's `tx`). Web instance is send-only; maintenance/cron belong to the single worker.

### Links in messages

| Message                        | Button target                                                           |
| ------------------------------ | ----------------------------------------------------------------------- |
| Organizer — new / cancelled    | `/login/link/{token}` → session → `/cabinet/bookings?slot={timeSlotId}` |
| Guest — confirmed              | `/booking/{manageToken}`                                                |
| Guest — cancelled by organizer | `/{orgSlug}` (rebook)                                                   |

### Delivery policy

Telegram bot can only message users who pressed **Start** — UX includes bot-start step after widget auth, with management deep link shown on-screen as fallback.

| Telegram response           | Action                                        |
| --------------------------- | --------------------------------------------- |
| `403`, `400 chat not found` | Complete job and log — no retry can succeed   |
| `429`, `5xx`, network       | Throw → pg-boss retries (5 attempts, backoff) |
| Other `4xx`                 | Fail loudly — our bug                         |

Worker refuses demo organizer in every handler (`isDemoOrganizerId`).

### Running locally

`bun run dev` starts **both** `web` and `worker`. Enqueue is transactional — booking with no worker still succeeds, jobs sit in `pgboss.job` as `created` until one starts. Check for running worker before suspecting send path:

```sql
select name, data->>'recipient' as recipient, state, retry_count
from pgboss.job order by created_on desc limit 10;
```

`created` = nothing consumed it. `failed` / non-zero `retry_count` = send failing; `output` column holds error.

Both processes read repo-root `.env` — worker via `--env-file=../../.env`.

## Out of scope

- Concrete DDL (Drizzle later).
- Deployment topology and CI.
- Payments, multi-staff, subdomain tenancy, Capacitor app ([roadmap.md](roadmap.md)).
