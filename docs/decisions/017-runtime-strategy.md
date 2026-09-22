# ADR-017: Runtime strategy — one vs two runtimes

- **Status:** Accepted (status quo + isolation, option C)
- **Date:** 2026-09-22
- **Related:** [ADR-013](013-api-go-rewrite.md), [ADR-016](016-standard-openapi-codegen.md)
- **Origin:** consolidated architecture review (glm §6, hy4 §5, mimo §4) — "the main strategic fork post-MVP"

## Context

The codebase runs two runtimes against one Postgres, one Redis and one auth secret: Next.js (pages, reads via Drizzle, Auth.js) and a Go API (all writes, jobs, notifications) deployed as a single Vercel project ([ADR-013](013-api-go-rewrite.md)). Cross-language parity is held together by pipeline discipline — contract vectors, golden samples, CI diffs — not by construction. The measurable costs found by the review:

- ~14k lines of Go with hand-written SQL/scan bindings duplicating the Drizzle schema (honestly acknowledged in `pkg/db/client.go`);
- a second Redis client, a second i18n runtime, DTO mappers ×2, a demo seed ×2;
- Go cannot invalidate Next.js caches (`revalidateTag`), which forced the removal of `unstable_cache` (review W-1, option B1);
- two test stacks and two observability setups.

## Decision

**Keep the two-runtime split (option C: status quo + isolation), revisited when a trigger condition fires.** The alternatives were evaluated and rejected for now:

- **A. One runtime (Next.js only).** Removes the whole polyglot seam, restores a single data-access layer and `revalidateTag`. Rejected for now: the Go API was just completed (ADR-013/016), writes benefit from Go's concurrency and cheap QStash handling, and the rewrite cost is not justified at current traffic.
- **B. Go as a separate service** (Fly/Railway/Cloud Run) with its own deploy and pool. Rejected for now: adds a second deploy pipeline, networking and secrets surface for no current scale benefit; the fat-lambda consolidation (ADR-013) already keeps the Vercel footprint simple.
- **C. Status quo + isolation (chosen).** The seam is real but bounded; the parity pipeline (vectors, goldens, generated router) makes drift a compile/CI error rather than a runtime surprise.

### Isolation rules (the "C" discipline)

1. Go owns **writes and jobs only**; it must not learn web-owned details (Next.js cache tags, web i18n outside job-handler copy).
2. Shared truth stays in `packages/contracts` (Zod) and `packages/translations`; Go consumes generated artifacts (`constants_gen.go`, i18n codegen), never hand-copies values.
3. The polyglot seam must not grow new duplication classes: new shared rules go into contracts/vectors, not into parallel Go code.

### Revisit triggers

Re-evaluate (toward A or B) when **any** of these holds:

- team grows beyond ~3 developers or the parity pipeline starts producing regular drift incidents;
- traffic makes the fat-lambda cold start or the inline publish latency user-visible;
- a second client (mobile app, third-party API) needs a standalone API surface;
- hosting-cost data shows the Go function is not paying for itself.

## Consequences

- The duplication costs found by the review are accepted **as bounded, monitored costs**, not tech debt to fix silently; any new duplication class requires an ADR amendment.
- The demo-seed single-source work (JSON artifact + parity test) and mapper golden tests remain on the backlog to shrink the seam.
- If a trigger fires, options A and B are the pre-analyzed paths — this ADR is the decision record for that fork, so the future choice starts from analysis, not from scratch.
