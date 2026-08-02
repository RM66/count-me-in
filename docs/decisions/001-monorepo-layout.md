# ADR-001: Monorepo layout

- **Status:** Accepted (amended 2026-07-20, 2026-07-31)
- **Date:** 2026-07-18

## Context

CountMeIn has guest web booking, an organizer web cabinet (opened from messenger links in MVP), shared types, DB schema, media helpers, and a notification worker.

## Decision

Use **Turborepo + Bun** with:

```
apps/web         # Next.js: landing + public booking + organizer cabinet + HTTP API
  lib/           # Business logic
    api/         # client-only React Query, one file per entity + keys.ts
    server/      # server-only: auth/, db/, storage/, demo.ts, redis.ts
    helpers/     # presentation formatting (date.ts, name.ts, contact.ts)
    constants/   # static data tables (timezones.ts)
    utils.ts     # cn() — shadcn `utils` alias target
  hooks/         # React hooks (shadcn-owned alias `@/hooks`)
  types/         # TypeScript utility types
  proxy.ts       # Auth.js v5 middleware — root location required by Next, do not move
apps/worker      # job consumer (notifications)
packages/db
packages/api-contracts
packages/storage
packages/eslint-config
packages/typescript-config
```

**`apps/` vs `packages/`:** `apps/*` are deployable processes. `packages/*` are libraries imported by apps.

**`apps/web/lib/` structure:** Organized by layer (api, server, helpers, constants) for scalability. See implementation for details.

**Root-file convention (`apps/web/`).** A file sits at the app root only if a
framework or tool discovers it there: `app/`, `proxy.ts`, `next.config.js`,
`postcss.config.mjs`, `tsconfig.json`, `eslint.config.js`, `components.json`,
`next-env.d.ts`. Everything we organise ourselves goes under `lib/`, `hooks/`,
`components/`, `types/`.

The test for whether a root file can move is **whether a config option points at
it.** `utils.ts` could move into `lib/` because `components.json` has a `utils`
alias to repoint (see the 2026-08-01 amendment). `proxy.ts` cannot: it is Next
16's rename of `middleware.ts`, matched by convention at the project root only,
with no config knob. Verified 2026-08-01 — moving it to `lib/proxy.ts` keeps the
build green while dropping `ƒ Proxy (Middleware)` from the output, i.e. the app
ships with no middleware and signed-in organizers are no longer redirected off
`/login` and `/signup`. A silent failure, so the constraint is also restated in
the file's own docblock.

**Amendment 2026-07-31 — `lib/services/` → `lib/server/`.** The original name
collided with the `Service` domain entity (услуга): `lib/services/service.ts`
made `service` mean both "the service layer" and "a услуга", and
`lib/services/storage/service-photo.ts` was ambiguous the same way. The entity
meaning is fixed by the `services` table, `/api/services` and `/cabinet/services`,
so the _layer_ was renamed instead. `server/` names the real invariant — the
server/client boundary — and is now mechanically enforced: every module under it
carries `import 'server-only'` (the shared ESLint config sorts side-effect
imports last, so it sits at the end of the import block), so a client import
fails the build rather than leaking DB or secrets into the browser bundle.
Inside it, code is grouped by
kind (`auth/`, `db/`, `storage/`), making `lib/server/db/service.ts` read as
layer → kind → entity with no segment doing double duty. `db/` (not `queries/`)
avoids a second collision with `lib/api/queries/`. Do not reintroduce
`lib/services/`.

React hooks were also consolidated into `apps/web/hooks/` (the shadcn `@/hooks`
alias from `components.json`); the parallel `lib/hooks/` directory is gone.

**Amendment 2026-08-01 — `lib/api/` sliced by entity; `lib/domain/` deleted.**

`lib/api/queries/` + `lib/api/mutations/` split each entity across two files, so
a query and the mutation that invalidates it never sat together — and both wrote
their cache key as an inline array literal (`['organizer','me']` appeared in two
files). Collapsed to one file per entity (`organizer.ts`, `service.ts`,
`auth.ts`) with keys centralised in `lib/api/keys.ts`. Consumers were unaffected:
every call site already imported from the `@/lib/api` barrel.

`domain/` vs `helpers/` was ambiguous because `helpers/` was defined by what it
_isn't_. Sorting the two by **rule vs rendering** showed `lib/domain/` had no
reason to exist: it was **dead code** with zero importers. `detectContactKind`
(builds `tel:`/`mailto:` hrefs — a rendering) moved to `helpers/contact.ts`, and
the rest was deleted:

- `effectiveContact` — a real rule from [domain.md](../domain.md), but never
  called; the `location` override it mirrors is applied inline at the call site.
- `slot.ts` (`seatsLeft`, `fillLabel`, `slotEnd`, `isBookable`, …) — the
  canonical copy, yet **every caller imports duplicates from
  `lib/mock-data.ts`**. Deleting the unused original is the honest state; the
  logic must be re-homed when `mock-data.ts` is dismantled, not resurrected as
  `lib/domain/`.

**Resolved 2026-08-02.** Those rules now live in `packages/api-contracts`
(`seatsLeft`, `fillLabel`, `slotEnd`, `slotPrice` in `time-slot.ts`;
`effectiveLocation` / `effectiveContact` in `service.ts`) and `mock-data.ts` is
gone — the guest section reads Postgres. No app-local rules layer was
resurrected, as intended: the package is isomorphic, dependency-light and already
entity-sliced, so the guest pages, the cabinet and the worker all import one copy.

Also in this pass: `timezone.ts` became `constants/timezones.ts` (a data table,
not a helper), and `image.ts` moved to `lib/api/image.ts` next to the two upload
mutations that are its only callers — it is browser-only, so it did not belong
beside isomorphic `date.ts`.

`apps/web/utils.ts` (just `cn`) also moved to `lib/utils.ts`, leaving `proxy.ts`
as the only loose file at the app root — where Next.js requires it. The root
placement had been config drift: shadcn's default for the `utils` alias is
`@/lib/utils`, and this project had it set to `@/utils`. Because that alias is
what the CLI writes into every generated component (33 of the 37 importers are
files in `components/ui/`), the file move and the `components.json` edit have to
be one atomic change — otherwise the next `shadcn add` emits
`import { cn } from '@/utils'` pointing at nothing. Verified afterwards via
`shadcn info --json` → `resolvedPaths.utils`. `cn` deliberately stays out of
`helpers/` despite being presentation: the name and path are part of shadcn's
contract, not ours.

**Considered and deferred: full vertical slicing** (`domains/{entity}/` each with
its own api/helpers/constants). Rejected for now because it cuts across the
server/client boundary, which is the only _compile-time enforced_ invariant here
(`import 'server-only'` / `'use client'`) — one folder per entity would mix
both, and a barrel re-exporting them would silently pull DB code into a client
bundle. The trigger named here — "revisit once booking + slots ship and
`lib/mock-data.ts` is gone" — was reached on 2026-08-02, and the answer is still
no: the server/client split remains the only compile-time enforced invariant, and
`lib/api/booking.ts` beside `lib/server/db/booking.ts` reads clearly without a
folder that would have to hold both. The entity-sliced `lib/api/` above is a
strict subset of that layout, so it is not wasted work if we go vertical later.

Shared lint/tsconfig come from the Turborepo starter as `eslint-config` + `typescript-config` (instead of a single `packages/config`).

**MVP:** do **not** add `apps/organizer` / Capacitor. Organizer UI is route group(s) inside `apps/web`. See [ADR-006](006-organizer-capacitor.md).

Do not add `apps/api` until API must outlive the Next deployment.

## Consequences

- Single web deployable + worker for MVP.
- UI (Tailwind + shadcn/ui) lives inside `apps/web` for MVP; extract a shared `packages/ui` only when a second client appears.
- Messenger deep links target `https://countmein.group/...` cabinet routes.
