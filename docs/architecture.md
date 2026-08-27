# Architecture

High-level system design for CountMeIn. Product domain in [domain.md](domain.md); decisions in [decisions/](decisions/).

## Product surfaces

| Surface           | App                         | Audience   | Responsibility                                                   |
| ----------------- | --------------------------- | ---------- | ---------------------------------------------------------------- |
| Landing           | `apps/web`                  | Prospects  | Marketing, organizer sign-up                                     |
| Public booking    | `apps/web`                  | Guests     | `https://countmein.group/{orgSlug}` — service → slot → book      |
| Organizer cabinet | `apps/web`                  | Organizers | Services, slots, bookings, profile — opened from messenger links |
| API               | `apps/web` (Route Handlers) | Clients    | HTTP API; Auth.js for organizers                                 |
| Jobs              | `apps/web` (Route Handlers) | QStash     | Messenger notifications / demo refresh — `POST /api/jobs/{queue}` |

**MVP entry for organizers:** register via Telegram Login Widget → profile form → booking notifications include cabinet deep link. No native app — [ADR-006](decisions/006-organizer-capacitor.md).

## Context diagram

```mermaid
flowchart LR
  Landing[apps/web Landing]
  Public[apps/web Public booking]
  Cabinet[apps/web Organizer cabinet]
  Messenger[Messenger WebView]
  API[apps/web API]
  Jobs[apps/web Jobs API]
  DB[(Postgres)]
  Redis[(Redis)]
  R2[(Cloudflare R2)]
  QStash[(Upstash QStash)]

  Landing --> API
  Public --> API
  Cabinet --> API
  Messenger -->|"deep link"| Cabinet
  API -->|"publish after commit"| QStash
  QStash -->|"signed delivery + cron"| Jobs
  Jobs -->|"notify + cabinet URL"| Messenger
  Jobs --> DB
  API --> DB
  API --> Redis
  API --> R2
```

## Component roles

| Component                                      | Role                                                                          |
| ---------------------------------------------- | ----------------------------------------------------------------------------- |
| `apps/web`                                     | Next.js: landing, public booking, cabinet, API, Auth.js, job handlers          |
| `packages/db`                                  | Drizzle schema, migrations, client                                            |
| `packages/redis`                               | ioredis singleton (sessions, auth tickets, rate limits)                       |
| `packages/contracts`                           | Zod schemas shared across the web app's layers                                |
| `packages/media-storage`                       | R2 signed upload helpers                                                      |
| `packages/eslint-config` / `typescript-config` | Shared lint & TS configs                                                      |
| Postgres                                       | Domain data                                                                   |
| Redis                                          | Sessions, short-lived auth tickets, rate limits                               |
| Upstash QStash                                 | Job queue: at-least-once delivery, retries, demo-refresh cron                 |
| Cloudflare R2                                  | Organizer avatar + service images ([ADR-007](decisions/007-cloudflare-r2.md)) |

## Critical flow: create booking (guest)

1. `GET` public page data by organizer `slug` (services, slots; cacheable).
2. Guest picks service/slot/options; enters name; authenticates with messenger login widget — server validates signed payload and issues short-lived guest ticket (Redis TTL; **no seat held**).
3. `POST` booking in one transaction (with the ticket):
   - validate `selectedOptions` against service
   - **claim seats atomically**: `UPDATE TimeSlot SET bookedCount = bookedCount + :seats WHERE id = :id AND bookedCount + :seats <= capacity RETURNING …` (not read-then-write)
   - if no row updated → slot full → abort
   - insert `Booking` (`confirmed`)
4. Commit, then publish `booking.created` to QStash (management link for guest; cabinet URL for organizer) via `after()`.
5. QStash delivers to `/api/jobs/booking.created`; the handler notifies guest + organizer.
6. Invalidate TanStack Query on public page (and cabinet if open).

If slot filled while authenticating, conditional `UPDATE` affects no row → abort. No `pending` status.

### Cancel (MVP)

Guests cancel on `/booking/{manageToken}` (deep link from messenger) or re-authenticate for booking lookup. Organizers cancel from cabinet. One transaction: set `cancelled` + decrement `bookedCount`; after commit the route publishes `booking.cancelled`.

### Media upload (organizer)

Authenticated organizer → signed upload URL → PUT to R2 → save URL on `photoUrl`.

## Auth boundary

- **Organizers:** Auth.js (Telegram Login Widget, server-side HMAC); session for cabinet. Notification deep links use **one-time login link**: the job handler stores `{ organizerId, next }` in Redis under 32-byte token → `/login/link/{token}` consumed via `POST` (server action calling `signIn`). `GET` does not consume — link previewers fetch URLs before human clicks. Single-use, 30-day TTL, `noindex`, demo id refused; failure → `/login`. See [ADR-008](decisions/008-messenger-only-auth.md).
- **Visitors:** No Auth.js account; booking requires widget auth (short-lived ticket); management via deep link or re-auth. See [ADR-002](decisions/002-guest-booking.md).

## Jobs / notifications

**Upstash QStash** consumed by `apps/web` route handlers; messengers primary ([ADR-008](decisions/008-messenger-only-auth.md), [ADR-012](decisions/012-queue-upstash-qstash.md)).

### Queues

| Queue               | Payload                      | Jobs per event                          |
| ------------------- | ---------------------------- | --------------------------------------- |
| `booking.created`   | `{ bookingId, recipient }`   | **Two** — one per recipient             |
| `booking.cancelled` | `{ bookingId, cancelledBy }` | One — counterparty only                 |
| `demo.refresh`      | —                            | Scheduled daily (`seedDemo()`, ADR-010) |

**One job per recipient** — a retry re-sends only to whoever failed. **Payloads carry ids only** — the handler refetches at send time, so `manageToken` and login tokens never leave the database boundary. Contracts in `packages/contracts/src/jobs.ts`.

**Publish after commit** (`apps/web/src/server/queue.ts`): the route handler publishes inside `after()` once the booking transaction has returned; QStash delivers to `POST /api/jobs/{queue}` with 5 retries. The accepted loss window is a crash between commit and publish ([ADR-012](decisions/012-queue-upstash-qstash.md)).

### Links in messages

| Message                        | Button target                                                           |
| ------------------------------ | ----------------------------------------------------------------------- |
| Organizer — new / cancelled    | `/login/link/{token}` → session → `/cabinet/bookings?slot={timeSlotId}` |
| Guest — confirmed              | `/booking/{manageToken}`                                                |
| Guest — cancelled by organizer | `/{orgSlug}` (rebook)                                                   |

### Delivery policy

Telegram bot can only message users who pressed **Start** — UX includes bot-start step after widget auth, with management deep link shown on-screen as fallback.

| Telegram response           | Action                                          |
| --------------------------- | ----------------------------------------------- |
| `403`, `400 chat not found` | Complete delivery (`200`) and log — no retry can succeed |
| `429`, `5xx`, network       | Throw → QStash retries (5 attempts, backoff)    |
| Other `4xx`                 | Fail loudly — our bug                           |

Every handler refuses the demo organizer (`isDemoOrganizerId`).

### Running locally

`bun run dev` starts `web`. Publishing needs `QSTASH_TOKEN`; without it dev skips publishing with a warning — bookings succeed, no notifications send. End-to-end delivery additionally needs a publicly reachable `APP_URL`, because QStash POSTs from Upstash to that URL (localhost is not routable — use a deployed preview or a tunnel).

Delivery state lives in the QStash console (message log, retries, events) — check it before suspecting the send path.

## Observability

Two tools, one job each — Sentry for errors and performance, PostHog for product analytics and behaviour.

| Tool        | Scope                                                                        | Where it runs                                                                   |
| ----------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **Sentry**  | Unhandled exceptions, crash reports, performance traces, source-map upload   | `apps/web` (client + server via `instrumentation.ts` + `sentry.client.config.ts`) |
| **PostHog** | Page views, funnels, feature flags, session replay, notification-sent events | `apps/web` (browser via `lib/posthog.ts`; server via `server/posthog.ts`)          |

### Sentry

- **Server init:** [`apps/web/src/instrumentation.ts`](../apps/web/src/instrumentation.ts) — `src/`-root Next.js convention (like `proxy.ts`); do not move. No-op without `SENTRY_DSN`.
- **Client init:** [`apps/web/sentry.client.config.ts`](../apps/web/sentry.client.config.ts) — loaded automatically by `@sentry/nextjs` in the browser bundle.
- **Error boundaries:** [`apps/web/src/app/error.tsx`](../apps/web/src/app/error.tsx) and [`apps/web/src/app/global-error.tsx`](../apps/web/src/app/global-error.tsx) call `Sentry.captureException`. The global boundary catches root-layout errors the regular boundary cannot.
- **Job dispatch:** [`apps/web/src/server/jobs/run.ts`](../apps/web/src/server/jobs/run.ts) captures unretriable failures (recipient unreachable); handler errors bubble to the route's `500`, where server instrumentation captures them. The publisher captures its own failures in `after()`.
- **Source maps:** `withSentryConfig` in [`apps/web/next.config.js`](../apps/web/next.config.js) uploads source maps during CI builds when `SENTRY_AUTH_TOKEN` is set.
- **Replay is off** — PostHog session replay covers the "what did the user do" question; enabling Sentry replay too would double the client payload cost.

### PostHog

- **Browser client:** [`apps/web/src/lib/posthog.ts`](../apps/web/src/lib/posthog.ts) — lazy singleton, initialised from [`apps/web/src/app/providers.tsx`](../apps/web/src/app/providers.tsx). Autocaptures page views; session replay masks all inputs (no PII).
- **User identification:** signed-in organizers are identified by `Organizer.id`. Guests stay anonymous — their messenger identity is PII that does not belong in analytics.
- **Server events:** [`apps/web/src/server/posthog.ts`](../apps/web/src/server/posthog.ts) exposes a `posthog-node` client. Job handlers emit `notification_sent` with `{ queue, recipient, bookingId }` after a successful send. Flushes after every event (`flushAt: 1`) — serverless functions may freeze as soon as the response is sent.
- **PostHog Cloud** — `NEXT_PUBLIC_POSTHOG_HOST` defaults to `https://app.posthog.com`.

### No-op without keys

Both SDKs check their env var before initialising, so local dev and CI run without accounts and tests are unaffected.

## Out of scope

- Concrete DDL (Drizzle later).
- Deployment topology and CI.
- Payments, multi-staff, subdomain tenancy, Capacitor app ([roadmap.md](roadmap.md)).
