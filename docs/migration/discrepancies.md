# Discrepancies: plan vs Go code (Phase 1)

Rule 0.2: when the plan and the Go code disagree, the Go code wins. **Resolution rule:** a discrepancy is _ported as-is_ to Python — byte-compatible behavior is the goal of the migration, so an oddity in Go becomes an explicit, tested oddity in Python. It is recorded here, and any deliberate fix happens after the Phase 6 cutover, on both sides or in the spec, never mid-migration. Each entry records what the plan claims, what the code does, and the resolution adopted.

1. **Spec operation count.** Plan §1.2 says "Expected count at baseline: 25 spec operations + healthz". Actual `openapi.yaml` at baseline has **23** operations; the plan's own breakdown (auth ×2, organizers ×6, services ×5, slots ×5, bookings ×4, jobs ×1) sums to 23. Resolution: 23 is correct; `check-inventory.ts` asserts 23.
2. **Rate limits enforced in code but absent from the route manifest.** `routes.ts` documents `rateLimit` only for telegramGuest, telegramSignup, createBooking, and the two upload-target endpoints. The Go handlers additionally enforce:
   - `POST /api/organizers` — `rl:register:<ip>` 10/hour (`organizers.go:31`)
   - `POST /api/bookings/lookup` — `rl:lookup:<ip>` 10/min (`bookings.go:123`)
   - `POST /api/bookings/cancel` — `rl:cancel:<ip>` 10/min (`bookings.go:167`)
     Resolution: Python ports the Go behavior (enforced limits); the manifest/spec stays untouched — the spec documents a subset, which is its stated intent ("Documented for the spec and for the 429 response; enforcement is in the handler").
3. **`GET /api/healthz` is not in the spec** by design (mounted in `pkg/api/server.go` outside the generated router). Plan §1.2 already accounts for this; recorded here so the Python side mounts it outside the OpenAPI-derived route set too.
