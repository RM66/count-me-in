# Roadmap

Phased delivery for CountMeIn. Architecture: [architecture.md](architecture.md). Domain: [domain.md](domain.md).

**Product host:** `https://countmein.group` — public pages at `/{orgSlug}`.

## MVP

- Turborepo: `apps/web`, `apps/worker`, packages (`db`, `api-contracts`, `storage`, `eslint-config`, `typescript-config`).
- `apps/web`: landing + public booking + **organizer cabinet** + HTTP API.
- Organizer flow: messenger login widget → notifications in that messenger → **deep link** opens cabinet in WebView/browser.
- Domain without Calendar: Organizer → Service → TimeSlot → Booking; display prices + service options.
- Guest booking with messenger login widget → atomic `confirmed`; cancel in MVP (guest + organizer).
- Messenger notifications via `pg-boss` + worker; Telegram first; `messenger` on organizer and booking.
- Image uploads (organizer avatar, service photo) via Cloudflare R2.
- Observability: Sentry, PostHog (basic).
- Docs: AGENTS.md + `docs/`.

Explicitly **not** in MVP:

- Separate organizer native/Capacitor app (`apps/organizer`)
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
- Optional Capacitor organizer shell if web-in-messenger is not enough ([ADR-006](decisions/006-organizer-capacitor.md)).
- Image variants / CDN resize if needed.
- Waitlist / notify-on-free-seat; realtime capacity if demand justifies.
- Occupancy analytics dashboard in cabinet: fill rate by time (hour-of-day / day-of-week heatmap), per service and slot, to reveal peak vs. slow times.

## Phase 3+

- Payments / deposits.
- Team members / roles; custom domains.
- Optional visitor accounts.
- External calendar sync.
- Alternate job broker if `pg-boss` outgrown.

## Settled choices

| Topic                  | Decision                                                                    |
| ---------------------- | --------------------------------------------------------------------------- |
| Domain / URL           | `countmein.group/{orgSlug}`                                                 |
| Auth                   | Messenger login widget (Telegram); `Organizer.id` only                      |
| Notifications          | Messengers (Telegram MVP) + cabinet deep links                              |
| Guest cancel           | MVP                                                                         |
| Organizer client (MVP) | Web cabinet in `apps/web` ([ADR-006](decisions/006-organizer-capacitor.md)) |
| Media                  | Cloudflare R2 ([ADR-007](decisions/007-cloudflare-r2.md))                   |
| Calendar entity        | Removed                                                                     |
