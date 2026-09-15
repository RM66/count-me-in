# api-go — the CountMeIn API

Serverless functions for Vercel (Go runtime), built on `net/http` only.
Implements the full API wire contract: same routes, same JSON payloads,
same status codes, same invariants (atomic seat reserve, demo read-only
guard, single-use tickets, QStash publish-after-commit). The TypeScript
route handlers have been deleted; Auth.js `[...nextauth]` stays in
Next.js permanently (ADR-013).

## Layout

- `api/` — one directory per route (the Vercel Go runtime compiles
  every `.go` file into its own serverless function and requires an
  exported `Handler(w, r)`); `index.go` resolves to the directory's
  path, `[id]`/`[queue]` are dynamic segments. Each file is a thin
  wrapper — the route logic lives in `internal/routes` so a local
  server can mount it (bracket dirs cannot be imported).
- `cmd/dev` — local dev server: the same handlers on a plain mux,
  with .env loading and request logging. Never deployed.
- `internal/contracts` — wire types (records, inputs, enums), ported
  from `@repo/contracts` Zod schemas; `Optional[T]` keeps Zod's
  absent/null/value tri-state.
- `internal/validation` — request-body validation (Zod port); error
  bodies mirror `z.flattenError`.
- `internal/db` — Postgres via pgx: queries + DTO mapping + demo seed
  (`array_to_json` projections for explicit NULL arrays; uuidv7/nanoid
  ids generated app-side like Drizzle's `$defaultFn` did).
- `internal/auth` — Auth.js session token decryption (JWE
  `dir`+`A256CBC-HS512`/`A256GCM`, HKDF-SHA256 key bound to the cookie
  name), Redis auth tickets, login links, Telegram widget HMAC.
- `internal/i18n` — embedded translations (ICU subset: placeholders +
  CLDR plurals for all 8 locales), locale detection
  (cookie `NEXT_LOCALE` → `Accept-Language` → `en`). The embedded files
  are verbatim copies of `packages/translations` — `go:embed` cannot
  escape this module and the Vercel deployment contains only
  `apps/api-go`, so the shared package is unreachable at build and
  run time; `scripts/sync-translations.sh` refreshes the copies and
  `scripts/check-translations.sh` (wired into `scripts/build.sh`)
  fails the build on drift.
- `internal/httpx` — responses, guards (`RequireWritableOrganizer`,
  `RequireGuestIdentity`), entity error→status mapping, recovery.
- `internal/storage` — Cloudflare R2 signed upload URLs (AWS SDK v2).
- `internal/queue` — QStash publisher (publish-after-commit).
- `internal/jobs` — QStash receiver verification + dispatch,
  notification handlers, Telegram Bot API client, message templates.
- `internal/demo` — read-only demo organizer guard (ADR-010).

## Local development

```sh
cd apps/api-go
go mod tidy
sh scripts/build.sh            # build + vet + tests + gofmt + translation drift check
go run ./cmd/dev               # local API server on :3001 (loads .env, logs requests)
```

**Run the web app against the Go backend** (from `apps/web`):

```sh
bun run dev   # Next.js on :3000 + Go API on :3001, proxied via beforeFiles rewrites
```

The proxy is `beforeFiles` rewrites in `next.config.js`
(`scripts/api-rewrites.mjs`) — `/api/auth/[...nextauth]` deliberately
stays on Next.js. In development the rewrites default to
`http://127.0.0.1:3001` when `GO_API_URL` is unset; in production
`GO_API_URL` is **required** (the rewrite helper throws if it is
missing), so the Go API must be deployed before the web build.

`GO_API_URL` is deliberately **not** in `.env`: the `dev` script
starts the Go server, and `next.config.js` falls back to the local
default, so plain `bun run dev` proxies to it automatically (Next loads
`.env` before `next.config.js`, so a value there would override the
fallback silently).

Env vars: `.env` is a symlink to the repo root `.env` (same convention
as `apps/web` — `ln -s ../../.env .env`), so both apps share one local
file; `AUTH_SECRET` must be the same on both sides anyway. See
`env.example` for the full list.

After editing `packages/translations`, refresh the embedded copies with
`bun run sync:go` (from `packages/translations`) or
`apps/api-go/scripts/sync-translations.sh` — CI fails the build if the
copies drift from the source.

CI: the `go-api` job in `.github/workflows/ci.yml` runs
`scripts/build.sh` on every PR and push.

## Notes / deviations from the TS API

- Session tokens: `@auth/core@0.41.3` encrypts JWT sessions as JWE
  (`dir` + `A256CBC-HS512`), key derived via
  `HKDF(AUTH_SECRET, salt=cookie name, info="Auth.js Generated Encryption Key (<cookie>)")`.
  Implemented with stdlib crypto (not `golang-jwt` — it cannot decrypt
  JWE). The integrity construction is anchored by golden vectors
  generated with the real `jose`+`@panva/hkdf` stack (see
  `internal/auth/jwt_test.go`).
- Validation is hand-rolled (Zod port), not `go-playground/validator`:
  tri-state fields (absent/null/value) and cross-field refinements
  need explicit code; error bodies mirror `z.flattenError`.
- `after()` has no equivalent on the Vercel Go runtime, so QStash
  publishes run inline after the DB commit and after the response is
  written, before the handler returns (bounded context, 3s) — the
  guest does not wait for QStash, but the function stays alive until
  the publish completes; same publish-after-commit contract (ADR-012).
- PostHog/Sentry captures from the TS handlers are replaced by
  structured JSON logging (`internal/logx`: one JSON object per line on
  stdout, captured by Vercel log drains) — no SDK in the dependency set.
- Booking routes get `maxDuration: 15` in vercel.json (they publish to
  QStash inline after the response); everything else stays at 10s.
- `internal/httpx` (not `internal/http`) — a package named `http`
  would collide with `net/http` at every import site.
- `api/` uses a directory per route (plan sketch had sibling files);
  sibling files in one directory would all declare `Handler` and
  break whole-package builds.
- Demo slot/booking ids and `DEMO_ORGANIZER_ID` are code constants
  (parity with `@repo/contracts`), not env vars
- The `go` directive is 1.24 (required by the AWS SDK); run
  `go mod tidy` with the bracket route dirs moved aside — the Go tool
  rejects '[' in import paths, so `go mod tidy`/`go build ./...` cannot
  walk them (Vercel builds each entry file individually, which does).
