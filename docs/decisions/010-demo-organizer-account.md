# ADR-010: Read-only demo organizer account

- **Status:** Accepted
- **Date:** 2026-07-30

## Context

The landing advertised a live example pointing at `/studio-demo`, rendered from
`mock-data.ts` — a parallel data path no real traffic exercised (regressions in
the real query path were invisible on the one page prospects see) whose slots
were pinned to a fixed `DEMO_NOW` and had already expired. The mock was deleted
once the guest section moved to Postgres; the seeded organizer below is now the
only copy of the sample content.

## Decision

1. **Seed the demo into Postgres** as a normal organizer at slug `demo`, served
   by the same queries as real pages.
2. **Mark it with a code constant**, not a column: `DEMO_ORGANIZER_ID` /
   `DEMO_ORGANIZER_SLUG` / `DEMO_ORGANIZER_PATH` in
   `packages/contracts/src/demo.ts`, shared by web, API, and seed.
3. **Reserve the `demo` slug** (joins ADR-009's list).
4. **Read-only server-side:** every write path refuses the demo id — and
   anonymous callers, who by construction can only be poking at the demo
   cabinet — with `403` + code `demo_read_only`. Disabled cabinet controls are
   UX only.
5. **`/cabinet` is open to anonymous visitors and shows the demo cabinet.**
   "Demo" is a property of the response resolved per request —
   `resolveCabinetOrganizerId()` in `src/server/demo.ts` (web reads) and
   `countmein/demo/` (API) — not a session. Signed-in organizers see their own
   data.
6. **`isDemo` is computed** on the profile response, never stored.
7. **Daily refresh:** `seed_demo()` (`countmein/db/seed.py`, also
   `bun run db:seed:demo`) is idempotent and rebuilds slot times relative to
   seed time; the `demo.refresh` QStash schedule runs it (kept in sync by
   `scripts/ensure-qstash.ts`).
8. **`/cabinet/*` is `noindex`.**

## Rationale

- **Anonymous instead of a demo session.** The demo's `messengerId` is the
  sentinel `demo-account` — no Telegram widget can sign it, so a session would
  need a public endpoint minting cookies for a hardcoded id, plus `signOut` and
  redirect special-cases. Per-request resolution has no state to leak or get
  stuck.
- **Constant instead of an `is_demo` column.** The id is needed at call sites
  anyway; ownership checks stay join-free; and a flippable security flag can't
  be set by a bad seed or stray `UPDATE`. Revisit only for multiple demos or
  per-visitor sandboxes — a later column is additive.
- **`403 demo_read_only`, not `401`, for anonymous writes.** The caller reached
  the only write UI available without a session; one refusal code keeps the
  client honest and simple.
- **`GET /api/organizers/me` falls back to the demo for anonymous callers** —
  every cabinet surface reads it. `PATCH` re-checks the session independently.
- **Slots rebuilt from seed time, not offset at read** — keeps demo branches out
  of the shared query path.

## Consequences

- The example exercises the production read path; `bookedCount` never drifts.
- **`/cabinet` is no longer protected by routing** — "it's under `/cabinet`" is
  not a security argument. Every cabinet read must scope through
  `resolveCabinetOrganizerId()`; every write must check the session and the
  demo id itself.
- Coverage is complete: organizer profile/avatar, services, slots, and guest
  booking create + cancel (guarded inside the transaction) all refuse the demo
  id, and notification handlers skip it — the sentinel messenger ids can't
  resolve to real chats anyway. If demo cancel ever became allowed, the
  deterministic demo `manageToken`s would become live credentials; the
  read-only guard is what makes them safe.
- A dead refresh schedule means a visibly stale demo — accepted as the signal.
