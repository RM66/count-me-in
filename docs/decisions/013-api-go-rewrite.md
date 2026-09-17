# ADR-013: Go API rewrite (`apps/web/api`)

- **Status:** Accepted
- **Date:** 2026-09-13

## Context

The API lived in `apps/web` as Next.js route handlers (`src/app/api/**`). The rewrite plan ([`plans/go-api-rewrite.md`](../../plans/go-api-rewrite.md)) called for a Go implementation on Vercel Functions — `net/http` only, no frameworks — targeting cold start, latency, and memory. Auth.js `[...nextauth]` handlers depend on the Auth.js library and are out of scope for the port.

## Decision

Add **`apps/web/api`** + **`apps/web/pkg`** — a Go module (`countmein`) deployed as Vercel Functions within the same project as `apps/web` (one directory per route under `api/`, shared logic in `pkg/`), implementing the same wire contract as the TS routes: same JSON bodies, status codes, error extras, and every load-bearing invariant (atomic seat reserve, single-use tickets via `GETDEL`, demo guard on all write paths, publish-after-commit, per-recipient fan-out, Telegram retry classification). Interop with the TS side was byte-level during the gradual cutover: same Postgres schema and queries, same Redis keys/TTLs/payload shapes, same QStash queue names and signature verification.

**Cutover is complete.** The TS route handlers have been deleted; only `app/api/auth/[...nextauth]/route.ts` remains (Auth.js, permanent). `apps/web/` is the Vercel project root — a single project deploying both Next.js and the Go API, so env vars are configured once. In production Vercel's Edge Router executes rewrites from `vercel.json` to `/api/entry` directly; in development `beforeFiles` rewrites in `apps/web/next.config.js` (reading from `vercel.json`) proxy `/api/*` to the local Go server (`http://127.0.0.1:3001`, started concurrently by `bun run dev`). `/api/auth/[...nextauth]` is deliberately excluded from `vercel.json` rewrites. The QStash schedule (`ensure-qstash.ts`) targets `APP_URL`, so the deployment serving that origin consumes job deliveries.

**Observability:** Sentry/PostHog SDKs are not in the Go dependency set; failures and product events are structured JSON on stdout (`internal/logx`), captured by Vercel log drains. This drops the booking product-analytics stream the TS handler fed to PostHog — accepted; restoring it is a follow-up.

## Consequences

- The API invariant exists in one language (Go). The wire contract is pinned by golden vectors (Auth.js JWE tokens minted with the real jose/@panva/hkdf stack, QStash signatures, Telegram widget HMAC), Redis/DB formats are shared rather than re-invented, and CI (`go-api` job) runs build + vet + tests + per-entry-file compilation + gofmt + a generated-translations freshness check (`git diff --exit-code`).
- Translations are generated: `scripts/generate-i18n-go.ts` reads `packages/translations` (the single source of truth) and emits `internal/i18n/translations_gen.go` with the `ApiErrors` section and all notification copy compiled into native Go maps — no `//go:embed`, no runtime JSON parsing, no duplicated files. CI regenerates and fails on uncommitted changes.
- Session tokens: `@auth/core@0.41.3` encrypts sessions as JWE (`dir` + A256CBC-HS512), not signed JWTs — the Go side decrypts with stdlib crypto, keyed by the same `AUTH_SECRET` and cookie-name-bound HKDF. An Auth.js upgrade that changes the format will surface as anonymous sessions on the Go side (logged once); the golden vectors are the first place to update.
- `after()` has no equivalent on the Vercel Go runtime: QStash publishes run inline after the DB commit and after the response is written, before the handler returns, under a bounded context — same publish-after-commit contract (ADR-012). The response is flushed first, so the guest does not wait for QStash; the function stays alive until the publish completes (or the 3s context expires).
- The Go API and Next.js app deploy as one Vercel project (root `apps/web/`), sharing env vars. The Go API serves all API traffic; `apps/web` retains server-side Postgres reads for pages (cabinet, public pages, sitemap, OG images) and Auth.js; all writes go through the Go API.
- **Single-function consolidation (follow-up):** the per-route entry files under `api/` were collapsed into one Vercel Function at `api/entry/index.go`, which dispatches via `pkg/routes.NewMux` (a shared `http.ServeMux`). `vercel.json` rewrites every `/api/*` route to `/api/entry`, carrying the original path as `?_path=` so the mux patterns (`/api/services/{id}`, `/api/jobs/{queue}`, …) match. This keeps the deployment under Vercel Hobby's 12-function limit (2 functions total: 1 Go + 1 Next.js) and lets one warmed instance + connection pool serve the whole API. See `docs/vercel-single-function-plan.md`.

## Read/write boundary (CQRS)

The split between `src/server/db/` (reads) and the Go API (writes) is a CQRS boundary: Next.js server components and server actions read Postgres directly for page rendering; every mutation — organizer profile, services, time slots, bookings, language preference — goes through the Go API over HTTP. The boundary is enforced at three layers:

1. **ESLint rule (`countmein/no-server-writes`)** — `apps/web/eslint.config.js` forbids `db.update().set()`, `db.insert()`, and `db.delete()` anywhere under `src/server/db/`. Every module there carries `import 'server-only'` and contains read functions only. The rule is a `no-restricted-syntax` selector that matches Drizzle write calls in that directory; a violation fails `bun run lint` in CI.

2. **Server-side write path (`goApiFetch`)** — `src/server/api.ts` exports `goApiFetch(path, init)`, the only sanctioned way for a Next.js server action to reach the Go API. It resolves the origin from the incoming `Host` header in production (same-origin via Vercel filesystem routing) or `GO_API_URL` in dev, and forwards the Auth.js session cookie so the Go handler can authenticate the caller via `httpx.RequireWritableOrganizer(r)` (which decrypts the JWE session and rejects demo/anonymous callers). Server actions that need to persist state call this helper instead of touching the database.

3. **Contract sync test (`check:contracts`)** — `apps/web/scripts/check-contracts.ts` verifies that shared constants between the TS contracts (`packages/contracts`) and the Go contracts (`apps/web/pkg/contracts`) agree: locales, demo IDs, QStash queue names, enum values, login-link TTL and key prefix. The Go side is parsed with regex against source files (not imported — the Go module is not a TS dependency); the TS side imports the Zod schemas and reads `.options` at runtime. The script runs in CI as `check:contracts` (Turborepo task, same matrix as `check:api-routes`).

The last write operation removed from `src/server/db/` was `updateOrganizerLanguage` (Phase 3.2): the `setLocale` server action now sets the locale cookie (primary effect) and calls `PATCH /api/organizers/me/language` on the Go API (best-effort sync of `organizers.language`); API failure is logged but does not throw, because the UI locale is driven by the cookie.
