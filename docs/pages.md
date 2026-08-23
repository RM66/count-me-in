# Pages / routes

Site map for CountMeIn, grouped by audience. URL scheme follows [domain.md](domain.md) (organizer `slug`, short `serviceId`, booking `manageToken`). Cabinet needs no session — anonymous visitors see read-only demo (ADR-010).

Legend: **MVP** unless marked _(later)_.

## 1. Landing / marketing (prospective organizers)

| Page  | Route                | Purpose                                    |
| ----- | -------------------- | ------------------------------------------ |
| Home  | `/`                  | Value prop, "how it works", CTA to sign up |
| Legal | `/terms`, `/privacy` | Terms and privacy _(desirable at launch)_  |

Landing links to both demo sides — guest page (`/demo`) and cabinet (`/cabinet`) — from hero and CTA ([ADR-010](decisions/010-demo-organizer-account.md)).

Signed-in organizers are **not** redirected from `/`: header swaps "Log in" for "Go to cabinet".

Rendering note: locale resolution reads cookies/headers per request ([ADR-011](decisions/011-i18n.md)), so every route renders dynamically — there is no static prerender. Public guest-page reads are cached instead: `unstable_cache` (5 min TTL) with tag invalidation on organizer/service writes; `app/sitemap.ts` re-reads the catalog on each fetch. Pages overwrite the `Vary` header with Next's internal RSC values, so they rely on not being shared-cached; `/api/*` sends `Vary: Accept-Language` for its localized error copy.

## 2. Guest (public booking, no Auth.js account)

| Page               | Route                    | Purpose                                                                       |
| ------------------ | ------------------------ | ----------------------------------------------------------------------------- |
| Organizer page     | `/{orgSlug}`             | Profile + services list. Slug min 4 chars, reserved words blocked (ADR-009)   |
| Service page       | `/{orgSlug}/{serviceId}` | Description, photo, price, slots with availability, options                   |
| Booking management | `/booking/{manageToken}` | Opened from messenger deep link. Details + **Cancel** + **Add to calendar**   |
| Booking lookup     | `/booking`               | Re-authenticate with widget → list of bookings (fallback when deep link lost) |

### Booking flow (modal/stepper on service page)

1. Pick slot → 2. Pick options → 3. Enter name → 4. Authenticate with widget (short-lived ticket, no seat held) → 5. **Success screen**: details, management link, **"Add to calendar"**

**"Add to calendar"** generates `.ics` / Google Calendar link from slot's `startsAt`/`endsAt`. No internal `Calendar` entity.

## 3. Organizer (cabinet)

Reachable without session: signed-in → own data; anonymous → read-only demo with banner and disabled controls ([ADR-010](decisions/010-demo-organizer-account.md)). All `/cabinet/*` are `noindex`.

| Page                | Route                                      | Purpose                                                                                                       |
| ------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Sign up             | `/signup`                                  | Telegram Login Widget → profile form (slug, name, timezone)                                                   |
| Log in              | `/login`                                   | Messenger login widget                                                                                        |
| Login link          | `/login/link/{token}`                      | One-time link from notification: establishes session, redirects to target page. Consumed by `POST`, `noindex` |
| Cabinet overview    | `/cabinet`                                 | Upcoming bookings, quick status                                                                               |
| Services list       | `/cabinet/services`                        | List; create / edit / delete                                                                                  |
| Service editor      | `/cabinet/services/{serviceId}` (+ `/new`) | Edit title, description, photo, defaults, options                                                             |
| Time slots          | `/cabinet/slots` (+ `?service=`)           | Schedule: list and create / edit / duplicate / delete slots                                                   |
| Bookings            | `/cabinet/bookings`                        | All bookings (transitively); filter; view detail; cancel                                                      |
| Profile / settings  | `/cabinet/settings`                        | Name, slug, description, avatar (R2), timezone, messenger                                                     |
| Occupancy analytics | `/cabinet/analytics`                       | Fill-rate heatmap _(later — Phase 2)_                                                                         |

## 4. Shared / system

| Page            | Purpose                                         |
| --------------- | ----------------------------------------------- |
| Not found (404) | Unknown slug, service, or invalid `manageToken` |
| Error (500)     | Global error boundary                           |
| Root redirect   | Logged-in organizer at `/` may go to `/cabinet` |

## Notes

- `manageToken` in URL is a secret; `/booking/{manageToken}` needs no re-auth (messenger already proved ownership). `/booking` requires re-authenticating with widget.
- Login-link token consumed on **`POST`**, never `GET` — link previewers would burn a single-use token. Visiting while already signed in redirects without spending.
- Slugs min 4 chars, reserved words blocked (`api`, `booking`, `cabinet`, `signup`, `login`, `terms`, `privacy`, `demo`) — ADR-009, ADR-010.
- `/demo` is seeded read-only organizer through normal `/{orgSlug}` route; all writes reject it (ADR-010).
- `TimeSlot` has no public URL — reached inside its service page.
- Only analytics dashboard is Phase 2; everything else is MVP.
