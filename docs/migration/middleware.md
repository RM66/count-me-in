# Middleware chain inventory (Phase 1.3)

Order matters — the Python port must reproduce this exact chain (plan §1.3, Phase 3.1).

## Request path (Go, `api/entry/index.go` → `pkg/api/server.go` → `pkg/httpx/middleware.go`)

1. **Vercel entry** (`api/entry/index.go: Handler`): mux built once at package init (`api.NewMux()`; env validation failure = panic = loud 500 on every request).
   - `_path` query param restoration: original path restored from `?_path=`; non-`/api/…` values answered 404; trailing slash trimmed (except `/`); `_path` stripped from `RawQuery` (`stripQueryParam`).
2. **Mux dispatch** (`pkg/api/server.go: NewMux`): `config.Validate()` at cold start; `GET /api/healthz` mounted on std `ServeMux`; everything else → generated oapi-codegen router (method-scoped patterns, path/query param extraction, kin-openapi request validation per `pkg/validation/spec.go`).
3. **`httpx.Recover`** (applied by the generated router's wrapper chain): sets default headers **before** the handler runs:
   - `Vary: Accept-Language` (API error copy is localized)
   - `X-Robots-Tag: noindex`
   - `Cache-Control: no-store`
   - `X-Content-Type-Options: nosniff`
   - `X-Frame-Options: DENY`
   - `Referrer-Policy: strict-origin-when-cross-origin`
   - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
   - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
   - then `defer` panic recovery: log (stack truncated to 8 KiB) + bare `500` (no body).
4. **Handler-level guards** (inside each route handler, not global middleware):
   - rate limit (`httpx.RateLimited` — Redis INCR+EXPIRE, fail-open, `Retry-After` header on 429)
   - `httpx.ClientIP` — `X-Forwarded-For` honored only on Vercel (`VERCEL=1`) or `TRUST_PROXY_HEADERS=1`
   - `httpx.RequireWritableOrganizer` (session JWT → organizer id; anonymous/demo → 403)
   - `httpx.RequireGuestIdentity` (single-use ticket, Redis `GETDEL`)
   - QStash signature verify (`pkg/jobs/receiver.go`) — first thing in the jobs receiver
5. **Error mapping** (`pkg/httpx/errors.go` + `response.go`): domain errors → JSON envelope `{error, code?, seatsLeft?, maxSeats?}` (byte-identical requirement; i18n via `ApiErrors` dictionaries); validation errors → 400 with field issues; `httpx.Flush` best-effort. JSON encoding rules: [json-encoding.md](json-encoding.md).

## Externally visible limits & timeouts (must be ported)

| Limit                                     | Value                            | Source                                  |
| ----------------------------------------- | -------------------------------- | --------------------------------------- |
| Request body bound                        | 1 MB → **413**                   | `httpx.ReadBodyOr413` (`guards.go:77`)  |
| Healthz probe timeout                     | 2 s (PG + Redis ping)            | `api/server.go:86`                      |
| Post-commit QStash publish budget         | 1500 ms (absorbs its own errors) | `routes/bookings.go` `publishBudget`    |
| Outbox mark (sent/skipped/failed) timeout | 5 s                              | `routes/bookings.go:341`                |
| Media cleanup (R2 delete) timeout         | 3 s, inline after response       | `routes/media.go` `mediaCleanupTimeout` |
| Telegram sendMessage HTTP timeout         | 10 s                             | `jobs/telegram.go:73`                   |
| QStash publish HTTP timeout               | 1 s                              | `queue/qstash.go:50`                    |

## Python mapping (Phase 3.1)

- `_path` restoration → ASGI middleware reading `scope["query_string"]`, restoring `scope["path"]`, stripping `_path` — before routing.
- `httpx.Recover` → Starlette middleware: same headers set on every response; exception handler for `Exception` → 500 (log + no body), overriding FastAPI defaults so no `{"detail": …}` ever appears; 404/405 for unknown routes must match Go mux output.
- Guards → FastAPI dependencies (`Depends`), same order semantics (rate limit before auth where Go does it).
- Healthz keeps its own recover (503 JSON naming missing env) and its own rate limit (30/min/IP).

## Recorder coverage gaps (by design)

Recording goes through `cmd/dev`, not the Vercel entry — so two behaviors are **not** covered by HTTP goldens and are ported from their Go tests instead:

- `_path` restoration from `api/entry/index.go` (foreign-path 404, trailing-slash trim, query stripping) — `api/entry/index_test.go` → `tests_py/test_path_rewrite.py`.
- `VERCEL=1` / `TRUST_PROXY_HEADERS=1` `X-Forwarded-For` handling in `ClientIP` — `httpx/ratelimit_test.go: TestClientIP` → `tests_py/httpx_/test_ratelimit.py`. The recorder env deliberately leaves both unset (XFF ignored), which the goldens pin as the default behavior.
