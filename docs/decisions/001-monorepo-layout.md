# ADR-001: Monorepo layout

- **Status:** Accepted (amended 2026-07-19)
- **Date:** 2026-07-18

## Context

CountMeIn has guest web booking, an organizer web cabinet (opened from messenger links in MVP), shared types, DB schema, media helpers, UI kit, and a notification worker.

## Decision

Use **Turborepo + Bun** with:

```
apps/web         # Next.js: landing + public booking + organizer cabinet + HTTP API
apps/worker      # job consumer (notifications)
packages/db
packages/api-contracts
packages/ui      # shared primitives (optional extraction; can start inside apps/web)
packages/storage # Cloudflare R2 helpers
packages/config
```

**`apps/` vs `packages/`:** `apps/*` are deployable processes. `packages/*` are libraries imported by apps.

**MVP:** do **not** add `apps/organizer` / Capacitor. Organizer UI is route group(s) inside `apps/web`. See [ADR-006](006-organizer-capacitor.md).

Do not add `apps/api` until API must outlive the Next deployment.

## Consequences

- Single web deployable + worker for MVP.
- `packages/ui` can stay thin until a second client appears.
- Messenger deep links target `https://countmein.group/...` cabinet routes.
