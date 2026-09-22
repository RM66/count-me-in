# ADR-018: CORS — same-origin only, no CORS headers

- **Status:** Accepted
- **Date:** 2026-09-22
- **Origin:** consolidated architecture review (P3 backlog) — "CORS: document same-origin-only as a decision"

## Context

The Go API (`/api/*` via the `vercel.json` rewrite) and the Next.js app are served from **one origin**: `https://countmein.group`. The browser client ([`api-client`](../../apps/web/src/api-client)) calls same-origin paths; there is no second web client, no mobile webview on another origin, and no third-party consumers of the API. The review found no CORS configuration anywhere and asked for an explicit decision instead of silence.

## Decision

**The API is same-origin only.** No `Access-Control-Allow-Origin` headers are emitted by either runtime:

- the Go API never adds CORS headers ([`pkg/httpx/middleware.go`](../../apps/web/pkg/httpx/middleware.go) sets security headers only);
- Next.js route handlers and `next.config.js` set no CORS headers either.

Consequences of this choice, by construction:

- **Cross-origin browser calls fail.** Without `Access-Control-Allow-Origin`, a browser blocks cross-site reads of API responses. Non-browser clients (curl, server-to-server) are unaffected — CORS is a browser-enforced policy, not an API gate.
- **No CSRF surface from CORS.** Combined with the minted `X-Organizer-Auth` header (not readable cross-origin) and `SameSite` cookies, cross-site pages cannot call the write API successfully from a browser.
- **Preflights never happen** for the simple request shapes used by `api-client` (JSON `POST` with JSON content-type does trigger preflight — it fails cross-origin, which is the desired outcome).

## Consequences

- Adding a second origin (marketing site on another domain, mobile webview, partner embed) requires amending this ADR: an explicit allowlist of origins, `Vary: Origin`, and credentials review — never `Access-Control-Allow-Origin: *` on authenticated endpoints.
- The QStash job endpoints (`POST /api/jobs/{queue}`) are authenticated by the `upstash-signature` header, not by CORS; they stay non-CORS by the same rule.
- This decision is enforced by absence: a grep gate for `Access-Control-Allow` in `apps/web` should stay empty; adding the header anywhere is a visible, reviewable diff.
