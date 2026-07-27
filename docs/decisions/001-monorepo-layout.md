# ADR-001: Monorepo layout

- **Status:** Accepted (amended 2026-07-20)
- **Date:** 2026-07-18

## Context

CountMeIn has guest web booking, an organizer web cabinet (opened from messenger links in MVP), shared types, DB schema, media helpers, and a notification worker.

## Decision

Use **Turborepo + Bun** with:

```
apps/web         # Next.js: landing + public booking + organizer cabinet + HTTP API
  lib/           # Business logic
    api/         # React Query hooks (mutations/, queries/, client.ts, error.ts)
    services/    # Server-side logic (auth, redis, otp/, booking/, storage/)
    domain/      # Pure business logic (slot.ts, etc.)
    helpers/     # Utilities (date.ts, etc.)
  types/         # TypeScript utility types
  utils.ts       # UI utilities (cn)
  proxy.ts       # Auth.js v5 proxy
apps/worker      # job consumer (notifications)
packages/db
packages/api-contracts
packages/storage
packages/eslint-config
packages/typescript-config
```

**`apps/` vs `packages/`:** `apps/*` are deployable processes. `packages/*` are libraries imported by apps.

**`apps/web/lib/` structure:** Organized by layer (api, services, domain, helpers) for scalability. See implementation for details.

Shared lint/tsconfig come from the Turborepo starter as `eslint-config` + `typescript-config` (instead of a single `packages/config`).

**MVP:** do **not** add `apps/organizer` / Capacitor. Organizer UI is route group(s) inside `apps/web`. See [ADR-006](006-organizer-capacitor.md).

Do not add `apps/api` until API must outlive the Next deployment.

## Consequences

- Single web deployable + worker for MVP.
- UI (Tailwind + shadcn/ui) lives inside `apps/web` for MVP; extract a shared `packages/ui` only when a second client appears.
- Messenger deep links target `https://countmein.group/...` cabinet routes.
