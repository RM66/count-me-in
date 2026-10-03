# ADR-001: Monorepo layout

- **Status:** Accepted (amendments folded into the text; the rename-by-rename history lives in git)
- **Date:** 2026-07-18

## Context

CountMeIn has guest web booking, an organizer web cabinet (opened from messenger links), shared types, media helpers, and notification job handlers.

## Decision

**Turborepo + Bun.**

```
apps/web                  # Next.js: landing + public booking + cabinet + API + job handlers
  src/
    app/                  # App Router: pages, layouts, route handlers
    server/               # server-only: api-client reads, auth/, demo.ts, internal-api.ts, redis.ts (import 'server-only')
    api-client/           # client-only React Query — the browser end of the wire
    helpers/              # presentation formatting (date, name, contact, location)
    constants/            # static data tables (timezones, languages, site)
    i18n/                 # next-intl request config + locale actions
    components/           # React components (shadcn/ui + app components)
    hooks/                # React hooks (shadcn-owned alias `@/hooks`)
    lib/                  # cross-cutting singletons only: posthog.ts, og/, seo.ts, utils.ts (cn)
    types/                # TypeScript utility types
    proxy.ts              # Auth.js v5 middleware — src/ root, do not move
    instrumentation.ts / instrumentation-client.ts  # Sentry init
  api/_lib/countmein/     # Python API (FastAPI) — ADR-021
packages/contracts        # Zod schemas, wire registry, route manifest, jobs/demo constants
packages/translations     # web + notification copy (ICU per locale)
packages/eslint-config
packages/typescript-config
```

`apps/*` are deployables; `packages/*` are libraries. Former `packages/db` and
`packages/redis` are deleted — Alembic owns the schema (ADR-022) and each runtime
keeps its own small Redis client.

**The data wire is the load-bearing seam.** `server/` (server-only, enforced by
`import 'server-only'` — a client import fails the build) and `api-client/`
(client-only) are the two ends of one wire, promoted to top-level `src/` peers
so the compile-time boundary sits at the top of the tree. `app/api/*` is the URL
end; `api-client/` is the browser end — the name exists because "api" meant
both ends until the rename.

**Layer naming.** The server layer is `server/`, never `services/` — `service`
already means the bookable offering (table, `/api/services`, `/cabinet/services`).
The Python API legitimately has `services/` (its application layer, ADR-023);
the ban is scoped to `src/`. `server/db/` is deleted — Next.js has zero Postgres
access; reads go over HTTP (`server/api-client.ts`).

**Root-file convention.** A file sits at `apps/web/` root only if a tool
discovers it there (`next.config.js`, `tsconfig.json`, `components.json`,
`postcss.config.mjs`, `eslint.config.js`, `next-env.d.ts`, …). The test for
whether such a file can move is **whether a config option points at it**:
`utils.ts` could move (the `components.json` `utils` alias repointed in the same
commit — the shadcn CLI writes that import into every generated component);
`proxy.ts` cannot — Next 16 finds the `middleware.ts` rename at the `src/` root
only, and a misplaced copy keeps the build green while silently shipping no
middleware. `instrumentation.ts` / `instrumentation-client.ts` sit at the `src/`
root for the same reason.

**Rejected: vertical feature slicing** (`features/{entity}/`). It cuts across
the server/client boundary — the only compile-time-enforced invariant — and a
barrel re-exporting a feature would silently pull `server-only` code into client
bundles. Kind-of-code layering keeps that leak impossible by construction.

## Consequences

- One deployable web app + the Python function for MVP; no `apps/organizer`/Capacitor (ADR-006).
- Shared lint/tsconfig come from the Turborepo starter as two packages, not one `packages/config`.
- Messenger deep links target `https://countmein.group/...` cabinet routes.
