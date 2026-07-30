# Pages / routes

Site map for CountMeIn, grouped by audience. URL scheme follows [domain.md](domain.md)
(organizer `slug`, short `serviceId`, booking `manageToken`) and the surfaces in
[architecture.md](architecture.md). Landing lives at the root; public booking at `/{orgSlug}`;
the organizer cabinet needs no session — anonymous visitors see the read-only demo cabinet
(ADR-010).

Legend: **MVP** unless a row is marked _(later)_.

## 1. Landing / marketing (audience: prospective organizers)

| Page  | Route                | Purpose                                                                 |
| ----- | -------------------- | ----------------------------------------------------------------------- |
| Home  | `/`                  | Value prop, "how it works", CTA to sign up. Entry point for organizers. |
| Legal | `/terms`, `/privacy` | Terms and privacy; linked in the footer. _(desirable at launch)_        |

The landing links to **both** sides of the read-only demo — the guest booking page (`/demo`) and
the organizer cabinet (`/cabinet`) — from the hero and the closing CTA ([ADR-010](decisions/010-demo-organizer-account.md)).

Signed-in organizers are **not** redirected away from `/`: the header swaps "Log in / Get started"
for a single **Go to cabinet** button instead. Keeps the page shareable and reviewable while logged
in, and keeps it statically prerendered (a server-side session check would make it dynamic for
everyone, including the anonymous search traffic the page exists for).

## 2. Guest (public booking, no Auth.js account)

| Page               | Route                    | Purpose                                                                                                                                                      |
| ------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Organizer page     | `/{orgSlug}`             | Organizer profile (name, avatar, Markdown description) + list of services. Shared as "me as a provider". Slug min 4 chars, reserved words blocked (ADR-009). |
| Service page       | `/{orgSlug}/{serviceId}` | Service description, photo, price (text), upcoming slots with availability, options. Shared to promote one service.                                          |
| Booking management | `/booking/{manageToken}` | Opened from the messenger deep link (messenger already proved ownership). Booking details + **Cancel** + **Add to calendar**.                                |
| Booking lookup     | `/booking`               | Guest re-authenticates with the messenger login widget → list of their bookings, then manage/cancel. Fallback when the deep link is lost.                    |

### Booking flow (steps on the service page — modal/stepper, not separate routes)

1. Pick slot
2. Pick options (if the service has any)
3. Enter name
4. Authenticate with the messenger login widget — server validates the signed payload and issues a short-lived guest ticket (no seat held)
5. **Success screen**: booking details, link to the management page, and an **"Add to calendar"** button

The **"Add to calendar"** button (shown on both the success screen and the booking management page)
is a client-side convenience that generates a downloadable `.ics` file and/or a Google Calendar link
from the slot's `startsAt` / `endsAt` and service title. It does **not** relate to any internal
`Calendar` entity (there is none by design — see [domain.md](domain.md)); it only helps the guest save
the appointment to their own device calendar.

## 3. Organizer (cabinet)

Reachable without a session: signed-in organizers see their own data, everyone else sees the
read-only demo organizer with a banner and disabled controls ([ADR-010](decisions/010-demo-organizer-account.md)).
All `/cabinet/*` pages are `noindex`.

| Page                | Route                                      | Purpose                                                                                                                 |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Sign up             | `/signup`                                  | Two-step flow: Telegram Login Widget → profile form (slug, name, timezone).                                             |
| Log in              | `/login`                                   | Messenger login widget. Deep links must land in an authenticated session.                                               |
| Cabinet overview    | `/cabinet`                                 | Upcoming bookings, quick status. Landing target for deep links.                                                         |
| Services list       | `/cabinet/services`                        | List services; create / edit / delete.                                                                                  |
| Service editor      | `/cabinet/services/{serviceId}` (+ `/new`) | Edit title, description, photo, defaultPrice, defaultCapacity, defaultDurationMinutes, options, optionsSelectMode.      |
| Time slots          | `/cabinet/services/{serviceId}/slots`      | List and create / edit / delete slots (startsAt, duration, capacity, price override). Defaults seeded from the service. |
| Bookings            | `/cabinet/bookings`                        | Bookings across all services (seen transitively); filter by service/slot; view detail; cancel.                          |
| Profile / settings  | `/cabinet/settings`                        | Name, slug, description, avatar (upload to R2), timezone, messenger.                                                    |
| Occupancy analytics | `/cabinet/analytics`                       | Fill-rate heatmap by hour/day, per service/slot. _(later — Phase 2)_                                                    |

## 4. Shared / system

| Page            | Purpose                                                     |
| --------------- | ----------------------------------------------------------- |
| Not found (404) | Unknown slug, service, or invalid `manageToken`.            |
| Error (500)     | Global error boundary.                                      |
| Root redirect   | Logged-in organizer visiting `/` may be sent to `/cabinet`. |

## Notes

- `manageToken` in the URL is a secret; `/booking/{manageToken}` needs no re-authentication (the messenger already proved
  ownership), whereas `/booking` requires re-authenticating with the login widget.
- Organizer slugs have a minimum length of 4 characters and cannot use reserved words (`api`, `booking`, `cabinet`, `signup`, `login`, `terms`, `privacy`, `demo`) to prevent route conflicts (ADR-009) and protect the demo page (ADR-010).
- `/demo` is a seeded, read-only organizer used by the landing page's example links. It renders through the normal `/{orgSlug}` route; all write paths reject it (ADR-010).
- A `TimeSlot` has no public URL — it is always reached inside its service page.
- Only the analytics dashboard is Phase 2; everything else is MVP.
