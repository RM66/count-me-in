# ADR-019: CSRF protection without Origin checks; rate limiter fails open

- **Status:** Accepted
- **Date:** 2026-09-22
- **Origin:** security hardening follow-up

## Context

The Go API serves state-changing endpoints (`POST/PUT/DELETE /api/...`) without an `Origin` header check, and the rate limiter lets requests through when Redis is unavailable. Both need either a fix or an explicit, documented decision.

## Decision

### 1. CSRF: minted-header + SameSite is the protection; no Origin check

The API is same-origin only ([ADR-018](018-cors-same-origin.md)) and its write surfaces are protected by credentials a cross-site page cannot obtain or attach:

- **Organizer writes** require `X-Organizer-Auth`, a signed JWT minted by `proxy.ts` from the Auth.js session. A cross-site page cannot read it (not a cookie, not readable cross-origin) and cannot make the browser attach it — the attacker's page would have to _guess_ the token.
- **Guest writes** require a single-use ticket or `manageToken` in the **request body** — never a cookie, never auto-attached by the browser. A cross-site form post cannot fill the body with a value it does not know.
- **QStash job endpoints** require the `upstash-signature` HMAC header — server-to-server, no browser involvement.
- The session cookie itself is `SameSite=Lax` (Auth.js default), so even cookie-authenticated Next.js server actions are not replayable cross-site.

An explicit `Origin` check would add a second, redundant layer, but it breaks legitimate flows (some in-app browsers and privacy proxies strip `Origin`) and adds a header-trust assumption we do not need. **The decision is: no Origin check; the credential design is the CSRF defense.** If a future endpoint accepts cookie-only auth, that endpoint must add an Origin check or a CSRF token — this ADR does not cover it.

### 2. Rate limiter fails open

`httpx.Allow` returns `true` when Redis is unreachable or `REDIS_URL` is unset ([ratelimit.go](../../apps/web/pkg/httpx/ratelimit.go)). This is deliberate: the limiter is abuse protection, not authentication. A Redis outage must not turn into a full API outage — the auth, ownership and demo guards do not depend on Redis and keep working. The cost is a temporary unthrottled window during a Redis incident; the atomic Lua script keeps the counting correct whenever Redis is reachable.

**Known limitation — client IP trust.** The limiter keys on `httpx.ClientIP`, which reads `x-forwarded-for`. On Vercel, the platform overwrites that header with the real client chain, so it is trustworthy in production. But the Go function is also reachable directly at `/api/entry?_path=…`, where a caller controls the header and can rotate the rate-limit key per request. This is accepted: the limiter is abuse protection for the public booking flow (which goes through the platform edge), not a defense against a determined direct caller — auth, ownership and demo guards do not depend on the IP at all. If direct-to-function abuse appears, the fix is to key on the platform-provided `x-real-ip` and reject requests where it is absent.

## Consequences

- Both decisions are enforced by absence: no `Origin` parsing in `pkg/httpx`, fail-open in `Allow`. Any change to either is a visible diff against this ADR.
- The limiter's atomicity was fixed as part of this decision: the sliding window is one Lua script, so concurrent requests cannot interleave past the limit.
