# Roadmap

Phased delivery for CountMeIn. Architecture: [architecture.md](architecture.md). Domain: [domain.md](domain.md).

**Host:** `https://countmein.group` — public pages at `/{orgSlug}`.

## MVP

- Turborepo: `apps/web`, `apps/worker`, packages (`db`, `contracts`, `media-storage`, `eslint-config`, `typescript-config`).
- `apps/web`: landing + public booking + **organizer cabinet** + HTTP API.
- Organizer flow: messenger login widget → notifications → **deep link** opens cabinet in WebView/browser.
- Domain without Calendar: Organizer → Service → TimeSlot → Booking; display prices + service options.
- Guest booking with messenger login widget → atomic `confirmed`; cancel in MVP (guest + organizer).
- Messenger notifications via `pg-boss` + worker; Telegram first.
- Image uploads (avatar, service photo) via Cloudflare R2, browser-downscaled to 512×512 WebP ([ADR-007](decisions/007-cloudflare-r2.md)).
- Read-only demo organizer at `/demo`, linked from landing; writes reject it, worker never notifies ([ADR-010](decisions/010-demo-organizer-account.md)).
- Observability: Sentry, PostHog (basic).
- Docs: AGENTS.md + `docs/`.

**Not in MVP:**

- Separate organizer native/Capacitor app
- Payment processing (prices are labels only)
- WebSockets / live seat counters
- Visitor Auth.js accounts
- Multi-staff organizations
- Subdomain tenancy
- Messengers beyond Telegram
- Email as required auth/notify channel
- PWABuilder

## Phase 2

- Reminder jobs; more messenger providers.
- Optional Capacitor organizer shell if web-in-messenger insufficient ([ADR-006](decisions/006-organizer-capacitor.md)).
- Image variants / CDN resize if needed (browser-side downscaling already in MVP — [ADR-007](decisions/007-cloudflare-r2.md)).
- Cleanup of superseded R2 objects on avatar change (deferred: versioned keys + small objects).
- Waitlist / notify-on-free-seat; realtime capacity if demand justifies.
- Occupancy analytics dashboard: fill-rate heatmap by hour/day, per service/slot.

## Phase 3+

- Payments / deposits.
- Team members / roles; custom domains.
- Optional visitor accounts.
- External calendar sync.
- Alternate job broker if `pg-boss` outgrown.

## Settled choices

| Topic                  | Decision                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------- |
| Domain / URL           | `countmein.group/{orgSlug}`                                                           |
| Auth                   | Messenger login widget (Telegram); `Organizer.id` only                                |
| Notifications          | Messengers (Telegram MVP) + cabinet deep links                                        |
| Guest cancel           | MVP                                                                                   |
| Organizer client (MVP) | Web cabinet in `apps/web` ([ADR-006](decisions/006-organizer-capacitor.md))           |
| Media                  | Cloudflare R2 ([ADR-007](decisions/007-cloudflare-r2.md))                             |
| Calendar entity        | Removed                                                                               |
| Demo account           | Seeded, read-only, code constant ([ADR-010](decisions/010-demo-organizer-account.md)) |
