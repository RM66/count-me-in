# Pages / routes

Site map for CountMeIn, grouped by audience. URL scheme follows [domain.md](domain.md)
(organizer `slug`, short `serviceId`, booking `manageToken`) and the surfaces in
[architecture.md](architecture.md). Landing lives at the root; public booking at `/{orgSlug}`;
the organizer cabinet is behind auth.

Legend: **MVP** unless a row is marked _(later)_.

## 1. Landing / marketing (audience: prospective organizers)

| Page  | Route                | Purpose                                                                 |
| ----- | -------------------- | ----------------------------------------------------------------------- |
| Home  | `/`                  | Value prop, "how it works", CTA to sign up. Entry point for organizers. |
| Legal | `/terms`, `/privacy` | Terms and privacy; linked in the footer. _(desirable at launch)_        |

## 2. Guest (public booking, no Auth.js account)

| Page               | Route                    | Purpose                                                                                                                                   |
| ------------------ | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Organizer page     | `/{orgSlug}`             | Organizer profile (name, avatar, Markdown description) + list of services. Shared as "me as a provider".                                  |
| Service page       | `/{orgSlug}/{serviceId}` | Service description, photo, price (text), upcoming slots with availability, options. Shared to promote one service.                       |
| Booking management | `/b/{manageToken}`       | Opened from the messenger deep link (messenger already proved ownership). Booking details + **Cancel** + **Add to calendar**.             |
| Booking lookup     | `/b`                     | Guest re-authenticates with the messenger login widget → list of their bookings, then manage/cancel. Fallback when the deep link is lost. |

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

## 3. Organizer (cabinet, behind auth)

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

- `manageToken` in the URL is a secret; `/b/{manageToken}` needs no re-authentication (the messenger already proved
  ownership), whereas `/b` requires re-authenticating with the login widget.
- A `TimeSlot` has no public URL — it is always reached inside its service page.
- Only the analytics dashboard is Phase 2; everything else is MVP.
