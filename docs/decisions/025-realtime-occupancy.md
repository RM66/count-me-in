# ADR-025: Realtime slot occupancy (SSE via Upstash Realtime)

- **Status:** Accepted
- **Date:** 2026-10
- **Supersedes:** [ADR-003](003-no-websocket-mvp.md)

## Context

ADR-003 kept MVP free of live transport: stale "seats left" was acceptable because the atomic `UPDATE … WHERE booked_count + :seats <= capacity` is the only overbooking guard. Concurrent demand has made the staleness a real product problem: two guests looking at the same slot, and the organizer's cabinet, must see occupancy change without a reload.

Constraints that shaped the choice: Next.js runs on Vercel Functions (`maxDuration` bounded, no long-lived server process); Redis is already in the stack (Upstash); the Python API has no Upstash SDK.

## Decision

Push occupancy-invalidation signals over **Upstash Realtime** — Redis Streams for bounded replay + Redis pub/sub for live delivery + a Server-Sent Events route on Next.js.

- **Emit:** after the booking create/cancel/capacity-patch commit, the Python API builds the `slot.occupancy` signal (`{ serviceId, organizerId }`) and rides it inside the existing Python→Next.js revalidation hop (`trigger_revalidation` → `POST /api/internal/revalidate`). The internal route then emits it onto two channels (`service:{id}` public, `organizer:{id}` private) through the official `@upstash/realtime` SDK — `XADD` + `EXPIRE` + `PUBLISH` and the record format are the library's to own, so emit and subscribe/history cannot drift apart.
- **Serve:** `src/app/api/realtime/route.ts` — the third permanent Next.js keeper (with `auth/[...nextauth]` and `internal/revalidate`). `@upstash/realtime`'s `handle` replays stream history from the client's `last_ack`, then forwards pub/sub. Channel middleware: `service:*` public; `organizer:{id}` requires `session.user.id === id`; demo id refused; empty ids and unknown families refused; the channel list is capped at 10 unique entries (`@upstash/redis` opens one subscribe connection _per channel_, so an uncapped list is a fan-out amplifier) — any forbidden channel refuses the whole subscription. `proxy.ts` excludes the path; Fluid Compute carries the `maxDuration` stream.
- **Invalidate:** HTTP remains the single source of truth for slot state — no slot counters or version numbers travel in the SSE payload. On the public service page (`useLivePublicService`), both incoming `slot.occupancy` events and `connected` transitions invalidate the React Query cache (`refetchOnMount` stays off in realtime mode so each mode issues one mount reconcile GET, plus reconnect/focus/interval triggers); the cabinet (`CabinetLive`) schedules a debounced `router.refresh()` on the same signals.

## Guarantees

- **UI freshness is not an invariant.** Overbooking is prevented only by the conditional UPDATE; a stale counter leads at worst to a `409 soldOut` the dialog already handles.
- **RETURNING is authoritative.** Every `UPDATE … RETURNING` runs with `populate_existing` so an already-mapped slot row in the session's identity map is refreshed with the database truth. Pinned by `tests_py/db/test_update_returning.py`.
- **Emit after commit, fail-open, bounded.** The revalidation hop carrying the signal runs concurrently with the other post-commit follow-ups under a shared `FOLLOWUPS_DEADLINE_SECONDS` budget; every error becomes a rate-limited warning. A realtime outage never fails a committed write — and a down hop also skips emit, which is the same failure the reconcile path exists for.
- **No application-side retry.** Delivery may skip or duplicate; invalidation is idempotent and periodic reconcile restores state.
- **Bounded retention.** `MAXLEN = 200`, `EXPIRE 86400` via the SDK's history bounds on emit; an ack older than the window yields partial replay, repaired by reconcile.
- **Never for the demo organizer.** Demo writes are refused upstream (ADR-010); `occupancy_event()` returns `None` for `DEMO_ORGANIZER_ID`, the route refuses it too, and the demo cabinet never subscribes.
- **Organizer channels are private; service channels are unauthenticated.** `service:{id}` carries exactly what the public page shows and bypasses the Python API — there is no app-level rate limit on it; each SSE client holds a Next.js function slot plus up to 10 Upstash subscribe connections (the channel cap above). Deliberate abuse is a platform-firewall question, not engineered in this iteration.

## Consequences

- Fluid Compute must be enabled on the Vercel project before the route ships; `maxDuration` (300 s) aligns with `Realtime.maxDurationSecs`.
- Realtime REST credentials resolve from `REDIS_REST_URL` (endpoint + token in userinfo — also how non-Upstash targets like the local up-redis emulator are addressed) or an Upstash-shaped `REDIS_URL` (`redis(s)://…:token@*.upstash.io` → `https://host` + the URL password). `realtimeRestConfig()` (TS) resolves at runtime for both the SSE route and the internal emit; `config.realtime_credentials()` (Python) is kept solely so `config.validate` fails the production cold start when neither resolves — Python itself never speaks REST to Redis anymore. Elsewhere unresolved means "off" (no emit, client never connects → "polling-fresh" mode).
- Emit is coupled to the revalidation hop: in a dev shell without `APP_URL`/`AUTH_SECRET` the hop skips and realtime silently stays off (TTL + reconcile cover it). The same hop also carries the `VERCEL_AUTOMATION_BYPASS_SECRET` protection bypass.
- The wire format is owned end-to-end by `@upstash/realtime`, so the emulator/protocol tests pin _backend_ parity, not format tracking. The compose `redis-http` emulator is `ghcr.io/coriou/up-redis` (amd64-only), which answers both `/pipeline` and the SSE `/subscribe` path, so the whole loop — emit, subscribe, live delivery — runs offline; a dedicated-Upstash CI tier still covers real-service parity.
- **Ping cost:** the SDK's SSE connection publishes a keep-alive ping to the first subscribed channel every 60 s — per connection, so N viewers produce N pings/min, each delivered to every subscriber of that channel (each delivered ping is also a pub/sub message billed/handled on the Upstash side). Harmless at MVP scale; a custom subscriber or upstream flag is the follow-up if it ever matters.
- In the pinned `@upstash/realtime` version the provider's reconnect counter resets on every `connect()`, so `maxReconnectAttempts` is not an effective cap: a subscribed tab retries the SSE connect about once a second, forever. That applies to _permanent_ refusals too — the library cannot tell a 403 (expired session on an organizer channel, demo organizer) from a transient failure, so such a tab retries until it closes. Accepted consciously: organizer channels are the rare path, the middleware cost is one `auth()` decode, and a custom backoff is a follow-up if the retry traffic ever matters. The periodic reconcile is the freshness floor during an outage.
- `proxy.ts` grows a matcher exclusion and an in-function guard for `/api/realtime`.
- Live coverage is deliberately scoped: only the per-service page (`/{orgSlug}/{serviceId}`) and the cabinet subscribe. The organizer page `/{orgSlug}` renders seats-left too but stays on the 60 s Data-Cache TTL plus revalidation tags — a channel per listed service would multiply subscriptions for a list view whose staleness is cosmetic.
- With realtime configured but SSE permanently blocked (a proxy that kills `EventSource`), the public page's reconcile floor is the 5-minute interval plus focus/reconnect triggers — strictly better than the pre-feature static page, and the provider retries the connect about once a second so "blocked" usually means transient.
- `CabinetLive`'s two-minute `router.refresh()` fallback runs for every open cabinet tab, including the anonymous demo view — a deliberate freshness floor for polling-fresh mode (realtime off / demo). The demo cabinet never subscribes: the route refuses `organizer:{demo}` and the client skips the request.
- Deleting/rescheduling/creating slots is not pushed — structural changes arrive through the reconcile.

## Rejected alternatives

- **WebSocket on Vercel Functions** (`experimental_upgradeWebSocket` + Redis pub/sub): experimental API, no history — every reconnect gap loses events — per-instance subscriber hubs to own.
- **Pusher / Ably:** a new vendor for one event type.
- **Separate always-on WS service:** contradicts ADR-021's single-function topology.
- **Hand-written Python emitter** (the initial implementation): reproduced the SDK's XADD/PUBLISH record format over REST — correct, but a second implementation of the same protocol, one library upgrade away from silent drift. Replaced by routing the payload through the revalidation hop to the official SDK.
- **TCP emit via `redis.asyncio`** (`countmein/redis.py` already holds a pool): would delete the REST hop for writes, but the subscribe side needs REST regardless (that's the only transport `@upstash/realtime` serves), so the REST surface stays either way; the revalidation-hop version keeps _all_ wire-format ownership in the SDK.
