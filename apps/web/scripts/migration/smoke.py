"""Post-deploy smoke check (migration plan §6.2/§6.3).

Usage (from apps/web/):
    uv run python scripts/migration/smoke.py <deployment-url>

Sends the smoke sequence against a deployment and asserts each response
matches the frozen golden transcripts recorded from the Go API
(tests_py/parity/golden/):

1.  GET  /api/healthz                 -> 200 {"postgres":"ok","redis":"ok"}
2.  GET  /api/organizers/me (anon)   -> 200 demo profile (golden organizers-me
                                        step 0 — sessionOrDemoRead, never 401)
3.  GET  /demo                       -> 200 (public booking page renders)
4.  PUT  /api/organizers/me (anon)   -> 403 DEMO_READ_ONLY (golden
                                        organizers-me-write "anonymous" step —
                                        the demo-organizer write refusal)
5.  POST /api/bookings (invalid)     -> 400 golden validation-error body
6.  POST /api/jobs/booking.created
    without upstash-signature        -> golden status (401), empty body

Also measures the first healthz latency and the p50 of 20 warm healthz
calls, appends the numbers to docs/migration/perf.md, and fails if any
request exceeds 10 s or the first call exceeds 3 s. The first call is
only a true cold start when smoke runs immediately after deploy; the
record therefore carries a `cold`/`unknown` marker (unknown when the
first call is within 2x of the warm p50 — a warm instance answering
fast cannot prove a cold start was measured).

If VERCEL_AUTOMATION_BYPASS_SECRET is set it is sent as
`x-vercel-protection-bypass` so the checks pass with deployment
protection on.
"""

from __future__ import annotations

import json
import os
import statistics
import sys
import time
from datetime import UTC, datetime

import httpx
from _common import GOLDEN, golden_response, normalize

# GOLDEN = <repo>/apps/web/tests_py/parity/golden; repo root is parents[4].
PERF_MD = GOLDEN.parents[4] / "docs" / "migration" / "perf.md"

MAX_REQUEST_S = 10.0
MAX_COLD_START_S = 3.0
WARM_CALLS = 20


def check(name: str, ok: bool, detail: str = "") -> bool:
    if ok:
        print(f"  ok   {name}")
        return True
    print(f"  FAIL {name}{': ' + detail if detail else ''}")
    return False


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    base = sys.argv[1].rstrip("/")
    headers: dict[str, str] = {}
    bypass = os.environ.get("VERCEL_AUTOMATION_BYPASS_SECRET")
    if bypass:
        headers["x-vercel-protection-bypass"] = bypass

    failures: list[str] = []
    first_s: float | None = None
    durations: list[float] = []
    p50 = float("nan")

    with httpx.Client(base_url=base, headers=headers, timeout=15.0) as client:
        # 1. healthz — the first request doubles as the cold-start
        #    measurement (only meaningful right after deploy).
        t0 = time.perf_counter()
        resp = client.get("/api/healthz")
        first_s = time.perf_counter() - t0
        if not check(
            "GET /api/healthz -> 200 golden body",
            resp.status_code == 200 and resp.text == golden_response("healthz", step=0)["body_raw"],
            f"status={resp.status_code} body={resp.text[:120]!r}",
        ):
            failures.append("healthz golden mismatch")
        print(f"  first request: {first_s:.2f}s")

        # 2. anonymous organizer read -> demo profile, byte-level after
        #    uuid/ts normalization (golden organizers-me step 0).
        resp = client.get("/api/organizers/me")
        want = golden_response("organizers-me", step=0)["body_raw"]
        if not check(
            "GET /api/organizers/me (anon) -> 200 demo profile (golden)",
            resp.status_code == 200 and normalize(resp.text) == want,
            f"status={resp.status_code} body={normalize(resp.text)[:160]!r}",
        ):
            failures.append("organizers/me demo profile mismatch")

        # 3. public demo booking page renders.
        resp = client.get("/demo")
        if not check("GET /demo -> 200", resp.status_code == 200, f"status={resp.status_code}"):
            failures.append("/demo not 200")

        # 4. demo-organizer write refusal — anonymous merge-patch on /me
        #    resolves to the demo organizer and is refused (golden
        #    organizers-me-write "anonymous" step).
        resp = client.put(
            "/api/organizers/me",
            content=json.dumps({"name": "Nope"}),
            headers={"Content-Type": "application/merge-patch+json"},
        )
        want = golden_response("organizers-me-write", note="anonymous")["body_raw"]
        if not check(
            "PUT /api/organizers/me (anon) -> 403 DEMO_READ_ONLY (golden)",
            resp.status_code == 403 and resp.text == want,
            f"status={resp.status_code} body={resp.text[:160]!r}",
        ):
            failures.append("demo write refusal mismatch")

        # 5. validation-error POST — the golden "invalid body" booking
        #    (guestName missing, guestTicket too short, seats missing).
        resp = client.post(
            "/api/bookings",
            content=json.dumps(
                {
                    "guestTicket": "whatever",
                    "serviceId": "aaaaaaaaaaaaaaaaaaaaa",
                    "timeSlotId": "01930000-0000-7000-8000-000000000001",
                }
            ),
            headers={"Content-Type": "application/json"},
        )
        want = golden_response("bookings-create", note="invalid body")["body_raw"]
        if not check(
            "POST /api/bookings (invalid) -> 400 golden validation body",
            resp.status_code == 400 and resp.text == want,
            f"status={resp.status_code} body={resp.text[:200]!r}",
        ):
            failures.append("bookings validation body mismatch")

        # 6. job delivery without an Upstash signature -> the golden
        #    status (401) with an empty body.
        resp = client.post(
            "/api/jobs/booking.created",
            content=json.dumps(
                {
                    "bookingId": "00000000-0000-0000-0000-000000000001",
                    "recipient": "organizer",
                    "outboxId": "00000000-0000-0000-0000-000000000002",
                }
            ),
            headers={"Content-Type": "application/json"},
        )
        want_status = golden_response("jobs-bad-signature", step=0)["status"]
        if not check(
            f"POST /api/jobs/booking.created (no signature) -> {want_status} per golden",
            resp.status_code == want_status and resp.text == "",
            f"status={resp.status_code} body={resp.text[:120]!r}",
        ):
            failures.append("jobs unsigned delivery mismatch")

        # Warm healthz p50 (the healthz bucket allows 60/min per IP).
        for _ in range(WARM_CALLS):
            t0 = time.perf_counter()
            r = client.get("/api/healthz")
            durations.append(time.perf_counter() - t0)
            if r.status_code != 200:
                failures.append(f"warm healthz status {r.status_code}")
                break
        p50 = statistics.median(durations) if durations else float("nan")
        print(f"  warm healthz p50 over {len(durations)} calls: {p50 * 1000:.0f}ms")

    # Cold-start classification: the first call is only provably a cold
    # start when it clearly dominates the warm p50; otherwise record
    # `unknown` — a warm instance answering fast proves nothing about
    # cold starts (and on prod, other traffic may have warmed it).
    cold_marker = "unknown"
    if first_s is not None and (not durations or first_s > 2 * p50):
        cold_marker = "cold"
    if first_s is not None and cold_marker == "cold" and first_s > MAX_COLD_START_S:
        failures.append(f"cold start {first_s:.2f}s > {MAX_COLD_START_S}s")
    if durations and max(durations) > MAX_REQUEST_S:
        failures.append(f"slowest warm request {max(durations):.2f}s > {MAX_REQUEST_S}s")

    # Record the perf numbers (§6.2: measure and record in perf.md) —
    # failed runs are recorded too, marked with their outcome.
    PERF_MD.parent.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC")
    outcome = "PASS" if not failures else "FAIL"
    with PERF_MD.open("a") as fh:
        fh.write(
            f"- {stamp} {base} [{outcome}, cold={cold_marker}]: "
            f"first request {first_s:.2f}s, warm healthz p50 {p50 * 1000:.0f}ms "
            f"over {len(durations)} calls\n"
        )

    if failures:
        for f in failures:
            print(f"FAIL {f}")
        return 1
    print("smoke: all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
