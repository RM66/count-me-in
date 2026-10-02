# 024 — API Hardening & Contract Convergence Plan

> **Status: accepted — implemented.** Synthesized from an independent architecture review of the
> post-[ADR-022](022-backend-refactoring-plan.md) / post-[ADR-023](023-backend-architecture-followups.md)
> codebase. Unlike those plans, this one starts from "what is the ideal shape of this
> system" rather than "what did the ADRs promise" — every item is evaluated on its own
> merit, and the fix chosen is the correct one, not the nearest one.

---

## 1. Principles

1. **Ideal over expedient.** Where a quick patch and the right fix diverge, the plan takes
   the right fix and prices it honestly.
2. **No over-engineering.** The ideal is the simplest form that does not cut corners:
   fewer moving parts, each with one job, each load-bearing seam pinned by a test.
3. **The spec is the source of truth.** Every improvement below either strengthens that
   or removes a place where reality is allowed to drift from it silently.

## 2. Findings recap

The review confirmed the core is strong: atomic seat reserve, transactional outbox with
dedup + consumer idempotency, layered guards, spec-driven decode. The findings are
hard-edge cases, spec drift, and one structural seam:

- `RestorePathMiddleware` honors a client-supplied `_path` on **any** request path.
- `validation/spec.py` fails **open**: if `openapi.yaml` is absent from the deployed
  bundle (it lives outside `includeFiles: "_lib/**"`), nullability/known-key checks
  silently become permissive.
- Spec ↔ handler drift: `deleteService` documents "cascade" and omits the real 409;
  `listSlots`'s `upcoming` enum is declared but unenforced; `listBookings` hand-parses
  `limit`/`offset` although `QueryLimit`/`QueryOffset` are declared.
- The guest ticket is consumed **before** domain refusals (`SoldOut`, `PartyTooLarge`,
  `InvalidOptions`), forcing a re-auth on the product's most common failure.
- Machine-readable `code` is emitted only by three errors; client tests already mock
  codes (`ticketExpired`, `bookingNotFound`, `alreadyCancelled`, `slot_sold_out`) that
  the server never sends — the client contract is aspirational, not real.
- The three partial-update endpoints are `PUT` carrying `application/merge-patch+json`;
  RFC 7386 semantics belong to `PATCH`.
- No `statement_timeout` on Postgres connections.
- `writable_state` maps, response `model_construct`, R2 env vars, `hasMore` pagination,
  JWT `aud`/`iss` — minor drift/robustness items.
- **Strategic:** the Zod→Python validation mirror (`decode/` + `refine.py` + `spec.py`
  - goldens) is well-executed but permanently hand-maintained. The ideal end-state is a
    spec that _is_ the validator, with transforms/refinements declared once in the wire
    registry and generated on both sides.

---

## 3. Phase A — hardening (no design change)

### A1. `_path` restore: bind to the rewrite destination

`RestorePathMiddleware` currently applies `_path` on any request. Restrict it to
`scope["path"] == "/api/index"` — the only path Vercel's rewrite can produce. Everything
else that carries `_path` is answered 404 (or ignored), so a direct hit outside the
rewrite can no longer steer dispatch or dodge the access log.

- `web/middleware.py`: gate the restore on the literal destination path.
- `tests_py/web/test_middleware.py`: add cases — `_path` on `/api/index` restores;
  `_path` on `/api/bookings` (or any other path) does not; client-supplied
  `_path` ordering is irrelevant once the gate exists.

### A2. Fail-closed spec loading + spec inside the bundle

Today `spec.py` reads `apps/web/openapi.yaml` at `parents[4]` and degrades to permissive
on any failure. Two compounding fixes:

- `scripts/generate-openapi.ts` additionally emits
  `api/_lib/countmein/contracts/spec_gen.json` — the parsed spec as JSON, inside
  `includeFiles: "_lib/**"`, so the validation input travels with the code that needs it.
- `spec.py` loads `spec_gen.json` (no YAML parser in the runtime path); a missing or
  malformed artifact raises — a packaging bug must be a loud 500, never a silently
  permissive validator.
- Update `tests_py/test_route_set.py` / invariant tests to pin that `spec_gen.json` exists
  and parses. `openapi.yaml` remains the human-facing/public document.

### A3. Close the spec ↔ handler drift

- `routes.ts` `deleteService`: correct the summary (slots cascade; any booking row —
  confirmed **or** cancelled — blocks with 409), add the 409 response with `errorBody`.
- `listSlots`: enforce the declared `enum: ['1']` — the handler signature becomes
  `upcoming: Literal["1"] | None = None`, so FastAPI's own query validation answers the
  400 envelope via `validation_exception_handler`.
- `listBookings`: replace the `int()` parsing with FastAPI-native
  `Annotated[int, Query(ge=1, le=100)]` / `Query(ge=0)` — the declared `QueryLimit`/
  `QueryOffset` bounds become the real validator; kills the Unicode-digit/whitespace
  quirks and the dual semantics.
- Regenerate `openapi.yaml` (+ `spec_gen.json`), re-run the oasdiff check and
  `test_route_set.py`.

### A4. Postgres `statement_timeout`

Both engine configs get `connect_args` extended with a server-side deadline under
`maxDuration` (10s): `options="-c statement_timeout=8000"` (psycopg passes `options`
through libpq — already in `_LIBPQ_OPTIONS`). Worker entry points that legitimately run
longer (demo seed/refresh) set `SET LOCAL statement_timeout` inside their transaction —
the default stays tight, the exception is explicit.

### A5. `code` on every error body

Make the machine-readable channel universal instead of incidental:

- `errors.py`: `ApiError` gains `code()` — default implementation returns
  `response_key()` (the i18n key is already a stable camelCase identifier);
  `DemoReadOnly`/`DuplicateBooking`/`InvalidOptions` keep their finer existing codes
  (`demo_read_only`, `duplicate_booking`, `invalid_option`) because the client already
  branches on them.
- `web/response.py`: `render_api_error` always emits `code`.
- `envelopes.ts`: `errorBody.code` becomes required; regenerate models + goldens.
- Client: `api-client/error.ts` treats `code` as always present on error bodies;
  test fixtures that mocked codes the server never sent (`ticketExpired`,
  `bookingNotFound`, `alreadyCancelled`, `slot_sold_out`) become real — the goldens pin
  them server-side from now on.

### A6. Minor batch

- `config.py`: add the `R2_*` variables to `_REQUIRED` — a production media
  misconfiguration must fail cold start like every other missing secret, not the first
  avatar upload.
- `writable_state` pin: one test per merge-patch entity asserting
  `writable_state(row).keys() == Update*Input.model_fields.keys()` — a new writable
  field forgets the map nowhere silently.
- `bookings` envelope: add `hasMore` (repo fetches `limit+1`, service trims) — prevents
  silent truncation without a COUNT query; wire schema + client updated together.
- Organizer-token JWT: mint `iss`/`aud` in `server/auth/organizer-token.ts`, verify in
  `auth/session.py`; regenerate the parity golden vector. Small blast radius, closes the
  "signature-only trust" gap.

## 4. Phase B — semantics

### B1. Defer guest-ticket consumption past domain refusals

The dependency order (rate limit → body → decode → ticket) exists so a _validation_
failure never burns the ticket. Extend the same principle one stage further: a _domain_
refusal must not burn it either.

- `web/deps.py`: new dependency `guest_ticket(decoded_dep, ticket_of)` returning the raw
  ticket string after decode; `guest_identity` stays for `booking_lookup` (nothing
  precedes consumption there).
- `booking_service.create_guest_booking` reorders: chain select → demo guard → options →
  party cap → atomic reserve → **consume ticket (401)** → insert → outbox. `SlotGone`,
  `InvalidOptions`, `PartyTooLarge`, `SoldOut` all leave the ticket intact — the guest
  retries with different seats without re-running the widget. A failed insert rolls back
  the reserve exactly as today; the ticket is spent only when a booking was genuinely
  attempted.
- `tests_py/routes/test_dependency_order.py` gains the new stage ordering;
  a service test pins "SoldOut leaves the ticket consumable".

### B2. `PATCH` for the three merge-patch endpoints

`PUT` + `application/merge-patch+json` is self-consistent but non-standard; the RFC 7386
pairing is `PATCH`. Change is mechanical but wide: `routes.ts` (`method: 'patch'`),
`routes/__init__.py` registration, `api-client` call sites, openapi regen, goldens,
docs. Keep `PUT` out entirely rather than aliasing both — one verb, one meaning.

### B3. Response-side contract validation in tests

`model_construct` on the way out is deliberate (the UUID-pattern quirk), but it means a
serializer can drift off-contract and only goldens would notice. Add a test-harness
assertion: `assert_matches_spec(operation, status, body)` that validates a real handler
response against the declared schema — via `jsonschema` + `spec_gen.json` (A2), which is
also the proving ground for Phase C. Roll it over the route test suite; a drift becomes
a red test, not a shipped body.

## 5. Phase C — the strategic seam: one validator, generated parity

**Problem.** Validation truth lives in Zod; the API re-expresses it in Pydantic models
plus a hand-written complement (`spec.py` nullability patching, `decode/core.py`'s
TypeError-UUID fallback and `_issue_reason` Pydantic→Zod message translation,
`refine.py`/`transforms.py` per-schema mirrors). Every new `.refine()`/transform is a
manual port pinned by vectors — correct, but permanent parallel maintenance.

**End state.** The committed OpenAPI document _is_ the request validator:

- **C1 — spec as validator.** `decode` becomes: raw dict → declared transforms →
  `jsonschema.validate` against `spec_gen.json` → declared refinements → DTO
  (`model_construct`, safe because the dict is already schema-valid). This removes the
  Pydantic-validation layer entirely: no lax-coercion gaps, no pattern-on-UUID TypeError
  fallback, no `X | None` nullability patching — JSON Schema answers all of it natively.
  `_issue_reason` shrinks to a jsonschema-error→message map (a smaller, stable
  vocabulary than Pydantic's error taxonomy), still pinned by the golden vectors.
- **C2 — declared transforms/refinements.** `wire.ts` `register()` gains optional rule
  metadata drawn from a small portable vocabulary —
  `transforms: { field: ['trim', 'lowercase'] }`, `refinements: ['optionsPair',
'slotStartNotPast', …]` — and `generate:py` emits `validation/rules_gen.py`. The
  vocabulary primitives are implemented once per language; per-schema mirrors
  (`decode/service.py`, `refine.py` tails) disappear. TS applies the same metadata in
  the Zod builders, so both sides derive from one declaration — parity becomes generated,
  not maintained.
- **C3 — cleanup.** Delete the hand-written per-entity decode tails and `spec.py`'s
  per-property probing; `models_gen.py` remains as typed DTOs only. Validation vectors
  and parity goldens keep working unchanged — they pin _behavior_, which is what the
  refactor must not move.

**Rejected alternatives.**

- _Validate in the Next.js BFF with Zod:_ the API stops being self-contained — any other
  caller bypasses validation entirely. Wrong direction for a real API.
- _A Node sidecar running Zod server-side:_ a per-request subprocess/HTTP hop on a
  serverless function — fragile and slower for negative cases, which are the common case.
- _A neutral schema DSL generating both sides:_ correct in theory, but the registry +
  spec pipeline already exists; a third abstraction is over-engineering against a
  problem JSON Schema already solves.

## 6. Explicitly out of scope (accepted limitations)

- **ICU subset** (`{param}` + `plural` only): sufficient for the current corpus; adopt a
  real ICU library when copy needs `select`, nesting, or gender — not before.
- **Observability beyond structured logs** (OTel tracing, metrics endpoint): the logx +
  trace-id + backlog events are the right floor for MVP; revisit at first incident that
  needs more.
- **API versioning**: single private consumer makes `/api/v1` ceremony without payoff;
  revisit if a public API ships.
- **`manage_token` plaintext column**: required by the re-issue design (lookup returns
  the token); the hash column is the lookup key and the expiry is bounded — accepted.
- **`SoldOut` seat count staleness**: UX copy, not an invariant — documented, leave.

## 7. Sequencing & verification

| Order | Item                           | Why first / depends on                                       |
| ----- | ------------------------------ | ------------------------------------------------------------ |
| 1     | A2 spec_gen + fail-closed      | groundwork for B3 and Phase C                                |
| 2     | A1 `_path` gate                | isolated, security-adjacent                                  |
| 3     | A3 drift fixes                 | spec edits ride the same regen as A2                         |
| 4     | A4 statement_timeout           | one-line config, immediate robustness                        |
| 5     | A5 error codes                 | contract change — regen + goldens + client fixtures          |
| 6     | A6 minors                      | independent                                                  |
| 7     | B1 deferred ticket consumption | behavior change, needs order-meta-test update                |
| 8     | B2 PATCH verb                  | wire-visible change; bundle with a release note              |
| 9     | B3 response validation harness | consumes spec_gen; pins the C1 rewrite                       |
| 10    | C1–C3 validator convergence    | the refactor; goldens/vectors must stay green byte-identical |

Every phase gates on: `bun run test`, `bun run test:py`, `lint:py` (ruff + mypy),
regenerated spec artifacts diffed clean, and the parity goldens — the suite's promise is
that none of this moves the wire.
