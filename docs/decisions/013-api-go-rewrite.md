# ADR-013: Go API rewrite (`apps/api-go`)

- **Status:** Accepted
- **Date:** 2026-09-13

## Context

The API lived in `apps/web` as Next.js route handlers (`src/app/api/**`). The rewrite plan ([`plans/go-api-rewrite.md`](../../plans/go-api-rewrite.md)) called for a Go implementation on Vercel Functions — `net/http` only, no frameworks — targeting cold start, latency, and memory. Auth.js `[...nextauth]` handlers depend on the Auth.js library and are out of scope for the port.

## Decision

Add **`apps/api-go`** — a self-contained Go module and Vercel project (one directory per route under `api/`, shared logic in `internal/`) implementing the same wire contract as the TS routes: same JSON bodies, status codes, error extras, and every load-bearing invariant (atomic seat reserve, single-use tickets via `GETDEL`, demo guard on all write paths, publish-after-commit, per-recipient fan-out, Telegram retry classification). Interop with the TS side was byte-level during the gradual cutover: same Postgres schema and queries, same Redis keys/TTLs/payload shapes, same QStash queue names and signature verification.

**Cutover is complete.** The TS route handlers have been deleted; only `app/api/auth/[...nextauth]/route.ts` remains (Auth.js, permanent). The routing mechanism is `beforeFiles` rewrites in `apps/web/next.config.js` (`scripts/api-rewrites.mjs`): every Go-owned `/api/*` route is proxied to `GO_API_URL` (`/api/auth/[...nextauth]` deliberately excluded). Locally `bun run dev` starts both Next.js and the Go API (`http://localhost:3001`) concurrently, and `next.config.js` proxies to it; in production `GO_API_URL` must point at the Go deployment (the rewrite helper throws if it is missing in production). The QStash schedule (`ensure-qstash.ts`) targets `APP_URL`, so the deployment serving that origin consumes job deliveries.

**Observability:** Sentry/PostHog SDKs are not in the Go dependency set; failures and product events are structured JSON on stdout (`internal/logx`), captured by Vercel log drains. This drops the booking product-analytics stream the TS handler fed to PostHog — accepted; restoring it is a follow-up.

## Consequences

- The API invariant exists in one language (Go). The wire contract is pinned by golden vectors (Auth.js JWE tokens minted with the real jose/@panva/hkdf stack, QStash signatures, Telegram widget HMAC), Redis/DB formats are shared rather than re-invented, and CI (`go-api` job) runs build + vet + tests + per-entry-file compilation + gofmt + an embedded-translations drift check against `packages/translations`.
- Translations are duplicated: `go:embed` cannot escape the module and the Vercel deployment contains only `apps/api-go`, so `internal/i18n/translations` holds verbatim copies, refreshed by `scripts/sync-translations.sh` and guarded by `scripts/check-translations.sh` (fails the build on drift).
- Session tokens: `@auth/core@0.41.3` encrypts sessions as JWE (`dir` + A256CBC-HS512), not signed JWTs — the Go side decrypts with stdlib crypto, keyed by the same `AUTH_SECRET` and cookie-name-bound HKDF. An Auth.js upgrade that changes the format will surface as anonymous sessions on the Go side (logged once); the golden vectors are the first place to update.
- `after()` has no equivalent on the Vercel Go runtime: QStash publishes run inline after the DB commit and after the response is written, before the handler returns, under a bounded context — same publish-after-commit contract (ADR-012). The response is flushed first, so the guest does not wait for QStash; the function stays alive until the publish completes (or the 3s context expires).
- The Go project deploys independently and serves all API traffic. `apps/web` retains server-side Postgres reads for pages (cabinet, public pages, sitemap, OG images) and Auth.js; all writes go through the Go API.
