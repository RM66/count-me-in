# ADR-013: Go API rewrite (`apps/web/api`)

- **Status:** Superseded by [ADR-021](021-api-python-rewrite.md) (2026-09-26)
- **Date:** 2026-09-13
- **Partially relaxed by:** [ADR-016](016-standard-openapi-codegen.md) — the "net/http only, no frameworks" rule admitted Go **library** dependencies (`kin-openapi`, `oapi-codegen/runtime`, `evanphx/json-patch`); the router stayed std `net/http`

## Summary

Replaced the Next.js route handlers (`src/app/api/**`) with a Go module (`countmein`) in `apps/web/api` + `apps/web/pkg`, deployed as Vercel Functions in the same project as `apps/web` (later collapsed into one "fat lambda" at `api/entry/index.go` dispatching via the oapi-codegen router, ADR-016). It implemented the same wire contract — same JSON bodies, status codes, error extras — and every load-bearing invariant (atomic seat reserve, single-use tickets via `GETDEL`, demo guard on all write paths, publish-after-commit, per-recipient fan-out, Telegram retry classification). Auth.js `[...nextauth]` stayed in Next.js permanently. The TS route handlers were deleted at cutover.

Decisions from here that survive in the Python API (ADR-021):

- **CQRS read/write boundary:** `src/server/db/` is reads-only (enforced by the `countmein/no-server-writes` ESLint rule); every mutation goes through the API over HTTP. The server-side write path (`src/server/api.ts`, now `apiFetch`) mints the short-lived `X-Organizer-Auth` HS256 token from the Auth.js session (`src/server/auth/organizer-token.ts`, HKDF-derived key from `AUTH_SECRET`) so the API can authenticate the caller without touching Auth.js internals.
- **Publish-after-commit inline after the response flush** (no `after()` hook on the serverless runtime), under a bounded 1.5s context — same contract as ADR-012.
- **No Sentry/PostHog SDK in the API:** structured JSON logs on stdout, captured by Vercel log drains; restoring the product-analytics stream is a follow-up.
- **One Vercel project** for web + API (root `apps/web/`), sharing env vars; `vercel.json` rewrites carry the original path as `?_path=`.

**Superseded (ADR-021):** the Go implementation was replaced wholesale by a Python 3.12 FastAPI application with byte-compatible HTTP behavior; the Go source was deleted. The full text of this ADR (Go CI job, i18n codegen, session-token amendment history, single-function consolidation) is preserved in git history.
