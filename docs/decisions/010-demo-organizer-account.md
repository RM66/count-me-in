# ADR-010: Read-only demo organizer account

**Status:** Accepted
**Date:** 2026-07-30
**Deciders:** Product, Engineering

## Context

The landing page advertises a live example (`See a live example`, `Browse an example page`,
and the `Examples` nav item). Until now those links pointed at `/studio-lumen`, a page rendered
entirely from `apps/web/lib/mock-data.ts` — a static module with a hardcoded organizer, three
services, ten slots and five bookings. (That module was deleted on 2026-08-02, once the guest
section moved to Postgres; it is described here in the past tense because it is the context this
decision was taken in.)

Two problems with keeping the example in the mock:

1. **It is a second data path.** The demo page never touches Drizzle, the API route handlers, or
   the React Query hooks. Any regression in the real query path is invisible on the one page we
   point prospects at, and the mock's own shapes are duplicates of the Zod contracts in
   `packages/contracts`.

2. **It silently expires.** The mock pins `DEMO_NOW` to a fixed instant and generates slots at
   `+0…+6` days from it. That window elapsed before this ADR was written: every advertised demo
   slot was already in the past. A demo whose freshness depends on a constant someone remembers
   to bump is a demo that is broken most of the time.

Separately, the mock is currently load-bearing: 13 modules import it and the entire cabinet plus
the public booking flow render from it. Only organizer profile, auth and avatar have real
endpoints; `apps/web/lib/server/db/booking/` is an empty placeholder.

## Decision

1. **Seed the demo content into Postgres** as a normal organizer, so the example page is served
   by the same queries as any real page.

2. **Mark the demo account with a code constant, not a database column.**
   `DEMO_ORGANIZER_ID` / `DEMO_ORGANIZER_SLUG` live in `packages/contracts/src/demo.ts`,
   shared by `apps/web` and `apps/worker`.

3. **Reserve the `demo` slug** by adding it to `RESERVED_SLUGS` (ADR-009's list).

4. **Enforce read-only server-side** in every write path, returning `403` with the machine
   readable code `DEMO_READ_ONLY`. Disabled inputs in the cabinet are UX only.

4a. **`/cabinet` is open to anonymous visitors and shows the demo cabinet.** There is no demo
session, no demo Auth.js provider and no demo cookie: "demo" is a property of the _response_,
resolved per request. A signed-in organizer sees their own cabinet; everyone else sees the
demo, read-only.

5. **Expose `isDemo` on the organizer profile API response**, _computed_ from the constant rather
   than stored, so the client can disable controls without a migration.

6. **Keep `mock-data.ts` for now.** Pages migrate off it as their endpoints land; the demo seed is
   an independent artifact and is not blocked on that migration. The mock now imports the shared
   demo id/slug/service-ids so the two cannot disagree.
   — _Completed 2026-08-02: the guest section moved to Postgres and the module was deleted. The
   seed is now the only copy of the sample content._

7. **Refresh the seed on a schedule.** Slot times are stored relative to seed time and rebuilt by
   an idempotent `seedDemo()`.

8. **Keep `/cabinet/*` out of search indexes** (`robots: noindex, nofollow`), since it is now
   publicly reachable.

## Rationale

### Why anonymous access instead of a demo session

Auth is messenger-only ([ADR-008](008-messenger-only-auth.md)): the demo's `messengerId` is the
sentinel `demo-account`, which no Telegram widget can sign. A demo session would therefore have
required a dedicated Auth.js provider handing out a cookie for a hardcoded id.

Treating "demo" as a per-request property removes that entirely — and with it a public endpoint
that mints sessions, the need to `signOut()` before signup, and the redirect loop where
[`authorized`](../../apps/web/lib/server/auth/index.ts) bounces a "logged in" demo visitor from
`/signup` back to `/cabinet`. Nothing can get stuck in a cookie because nothing is stored.

**The cost, accepted deliberately:** `/cabinet` is no longer gated by one line in `authorized`, so
a cabinet route no longer implies an authenticated organizer. Write protection lives entirely in
the API layer and every mutating endpoint must check the session itself.

### Why a constant instead of an `organizers.is_demo` column

- **The demo id must be nameable in code regardless.** Resolving "which organizer does an
  anonymous cabinet request see?" needs the id at the call site. Given that, a column is
  _additional_ state rather than the source of truth.
- **Ownership checks stay free.** Mutations already compare `service.organizerId` with
  `session.user.id`. Reading a flag would add a join or a second query to every mutation to
  re-derive something a constant knows statically.
- **A mutable boolean is a security-relevant switch.** A bad seed or a stray `UPDATE` could set
  `is_demo` on a real account (silently making it read-only) or clear it on the demo one (making
  the public example writable). A constant only changes via deploy and code review.
- **The worker needs the same answer.** Sharing one constant through `contracts` avoids two
  services disagreeing about which account is fake.

A column becomes the better choice if we ever want multiple demos, per-visitor sandboxes, or to
exclude demo rows in SQL for analytics. None are on the [roadmap](../roadmap.md), and adding the
column later is a purely additive migration — so waiting costs nothing.

### Why `isDemo` is derived, not stored

The cabinet wants a boolean on the profile object. Computing it server-side from the constant
gives the client the same ergonomics as a column while making desync structurally impossible.

### Why guards reject anonymous callers as `DEMO_READ_ONLY` rather than `401`

An anonymous request to a cabinet write endpoint is, by construction, someone poking at the demo
cabinet — the only way to reach that UI without a session. Answering `401 Unauthorized` would be
technically accurate and practically useless: the client would show a generic failure for what is
really "this is a demo". One refusal code keeps the client simple and the message honest.

### Why `GET /api/organizers/me` returns the demo for anonymous callers

Every cabinet surface — sidebar, settings form, `useIsDemo()` — reads this one endpoint. Having it
401 for anonymous visitors would render the demo cabinet as an error state. So it answers "the
organizer this request may view", which is a slight stretch of `me` and is documented as such in
the handler. `PUT` does **not** inherit that leniency: it re-checks the session independently.

### Why slot times are relative to seed time

The alternative — storing offsets and resolving them at read time — would push a demo-only branch
into the shared query layer and the domain model. Rebuilding rows on a schedule keeps the demo
indistinguishable from real data at read time, which is the entire point.

## Consequences

### Positive

- The example page exercises the production read path, so regressions surface there.
- Read-only means `bookedCount` never drifts: seeded fill levels stay realistic and attractive.
- One shared constant covers web, worker and seed.
- `demo` can no longer be registered by a real organizer.
- Prospects can explore the **cabinet**, not just the public page, with zero friction — no signup,
  no session, nothing to clean up afterwards.

### Negative

- A scheduled job is now required to keep the demo fresh; if it stops, slots go stale (visibly, on
  the public page).
- **`/cabinet` is no longer protected by default.** It is not matched by the middleware at all, so a
  new cabinet page is public unless its data access is scoped through
  `resolveCabinetOrganizerId()`. Every mutating endpoint must check the session itself; "it's under
  `/cabinet`" is no longer a security argument.
- Every new write path must remember the guard. Mitigated by concentrating the helpers in
  `apps/web/lib/server/demo.ts` with a coverage checklist in its docblock.
- `GET /api/organizers/me` no longer strictly means "me" — it falls back to the demo organizer for
  anonymous callers.
- The demo `manageToken`s are deterministic and effectively public. Acceptable only _because_
  cancel is rejected for demo bookings — if that guard is ever removed, the tokens become a real
  vulnerability.

### Neutral

- The demo organizer holds sentinel messenger ids (`demo-account`, `demo-guest-*`) that are not
  real Telegram accounts, which also makes accidental notification delivery impossible.

## Implementation

1. `packages/contracts/src/demo.ts` — id, slug, path, service ids, `DEMO_READ_ONLY` code and
   message, `isDemoOrganizerId()` / `isDemoOrganizerSlug()`.
2. `packages/contracts/src/primitives.ts` — add `demo` to `RESERVED_SLUGS`.
3. `packages/contracts/src/organizer.ts` — add `isDemo: boolean` to `organizerProfile`.
4. `packages/db/src/seed/demo.ts` + `run-demo.ts` — seed data and idempotent upsert; exposed as
   `bun run --filter @repo/db db:seed:demo` and as `seedDemo()` for the worker.
5. `apps/web/lib/server/demo.ts` — `resolveCabinetOrganizerId()` (per-request "whose cabinet is
   this?"), `rejectDemoWrite()` (route handlers), `assertNotDemo()` / `DemoReadOnlyError` (service
   layer), `isDemoSession()` (server components). Guards treat anonymous as demo.
6. Guards wired into `PUT /api/organizers/me` and `POST /api/organizers/me/avatar`; the checklist
   in the module docblock tracks the endpoints still to come (services, slots, guest booking
   create/cancel).
7. `apps/web/lib/server/auth/index.ts` — `authorized` gates nothing; it only redirects signed-in
   organizers away from the auth pages. `apps/web/proxy.ts` — matcher narrowed to `/login` and
   `/signup`, since running middleware on `/cabinet/*` would decode the JWT only to allow the
   request.
8. `apps/web/app/api/organizers/me/route.ts` — `GET` falls back to the demo organizer with
   `isDemo: true` when there is no session.
9. `apps/web/lib/api/organizer.ts` — `useIsDemo()` for client components.
10. `apps/web/app/cabinet/_components/demo-banner.tsx`, mounted in the cabinet layout;
    `robots: noindex, nofollow` in the same layout.
11. `apps/web/app/cabinet/_components/cabinet-sidebar.tsx` — **Log in** + **Sign up** replace the
    account menu while viewing the demo.
12. Landing links (`hero`, `cta`, `site-header`) point at `DEMO_ORGANIZER_PATH`.

### Still to do

- Organizer-side booking cancel from the cabinet — the last write path without a guard.
  Everything else is covered: **services** (`POST /api/services`, `PUT|DELETE /api/services/[id]`,
  `POST /api/organizers/me/service-photo`), **slots** (`POST /api/slots`,
  `PUT|DELETE /api/slots/[id]`) and, since 2026-08-02, **guest booking + cancel**
  (`POST /api/bookings`, `POST /api/bookings/cancel`) all reject the demo id — the guest paths via
  `assertNotDemo()` inside the booking transaction, since they are reached without a session.
  Every cabinet page reads through `resolveCabinetOrganizerId()`.
- Recurring `pg-boss` job calling `seedDemo()`; notification handlers skipping demo ids.
- A test asserting `demo` is rejected by the `slug` schema.
- A test asserting anonymous `PUT /api/organizers/me` answers `403 DEMO_READ_ONLY`.
- A test asserting `POST /api/bookings` against a demo slot answers `403 DEMO_READ_ONLY` and leaves
  `bookedCount` untouched.

## Alternatives considered

### Keep the demo in `mock-data.ts`

**Rejected.** Maintains a parallel data path that no real traffic exercises, duplicates the Zod
contracts, and — as observed — expires without anyone noticing. The module was deleted outright on
2026-08-02, so this alternative is now closed rather than merely declined.

### `organizers.is_demo` boolean column

**Rejected for now.** Redundant next to a constant the login path already requires, adds a read
to every ownership check, and introduces a flippable security-relevant flag. Revisit if multiple
demo accounts or SQL-level filtering are needed.

### Dedicated Auth.js `demo` provider granting a real session

**Rejected.** Requires a publicly callable endpoint that mints a session cookie, plus special
cases so a demo visitor is not redirected away from `/signup` by the `authorized` callback, plus a
`signOut()` step before registration. Anonymous per-request resolution achieves the same UX with
no session state to leak or get stuck. Revisit only if the demo ever needs to be _writable_
(a sandbox), where a per-visitor session becomes unavoidable.

### Environment variable instead of a constant

**Rejected.** The demo id must match the seeded row exactly; splitting that across env config in
several deploy targets invites drift with no benefit, since the value is not a secret.

### Resolve demo slot times at read time

**Rejected.** Puts a demo-only branch in the shared query path and the domain model.

## Related

- [ADR-008: Messenger-only auth](008-messenger-only-auth.md) — why a demo login is a special case.
- [ADR-009: Reserved slugs](009-reserved-slugs-cabinet-route.md) — the list `demo` joins.
- [ADR-002: Guest booking](002-guest-booking.md) — guest write paths that need the guard.
- [Domain model](../domain.md) · [Roadmap](../roadmap.md)
