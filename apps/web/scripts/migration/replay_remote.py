"""Remote parity replay (migration plan §6.2).

Usage (from apps/web/):
    uv run python scripts/migration/replay_remote.py <deployment-url>

Replays the read-only and demo-refusal subset of the parity scenarios
against a deployed API and asserts each response matches the frozen
golden transcript. A remote deployment shares its database with
production, so only steps that

- need no locally minted credentials (session JWTs, guest/signup
  tickets, widget payloads, QStash signatures — all signed with the
  recorder's keys, which the deployment does not trust), and
- write nothing (or write only to the read-only demo organizer, which
  refuses everything — ADR-010)

are replayed. Every other step is skipped and reported. The comparison
uses the same normalization as tests_py/parity/test_replay.py (uuid/ts
placeholders by first appearance), applied to both sides, and also
compares the response headers the goldens pin (the security headers the
recorder deliberately recorded).

Golden-step alignment mirrors test_replay.py: the golden transcript
contains one entry per REQUEST (non-request steps — reset, seed, mint —
never appear, and `repeat` is expanded), so the golden index advances
per request and per repeat iteration, and every replayed step asserts
the golden entry really is the same method+path before comparing.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx
import yaml
from _common import GOLDEN, is_excluded_header, normalize

HERE = Path(__file__).resolve().parent
SCENARIOS = HERE.parents[1] / "tests_py" / "parity" / "scenarios"

# Scenarios/steps that are destructive against a shared deployment:
# the rate-limit scenario exists to exhaust buckets (429), and any
# step with `repeat` hammers one — remotely that would throttle real
# traffic from this IP for up to an hour.
DESTRUCTIVE_SCENARIOS = {"healthz-rate-limit"}

# Placeholders that require local minting (Redis tickets, session JWTs
# signed with the recorder secret, captured ids from earlier steps) —
# a step whose request mentions any of them cannot run remotely.
MINTED = (
    "<session>",
    "<demoSession>",
    "<guestTicket>",
    "<signupTicket>",
    "<widgetPayload>",
    "<slotId>",
    "<serviceId>",
    "<bookingId>",
    "<manageToken>",
)


def step_is_remote_safe(step: dict) -> bool:
    if "request" not in step:
        return False
    if step.get("mint"):
        return False
    if int(step.get("repeat", 1)) > 1:
        return False
    blob = json.dumps(step["request"])
    return not any(p in blob for p in MINTED)


def compare_headers(resp: httpx.Response, golden_headers: dict) -> tuple[str | None, str | None]:
    """Compare the headers the goldens pin. Returns (problem, warning).

    `retry-after` is a TTL countdown (time-dependent) — the golden
    records the class, so only presence is compared. Headers the golden
    pins but the deployment lacks (or answers differently) are a
    problem; headers the platform adds on top are only a warning, so
    Vercel's own bookkeeping cannot fail the parity check."""
    got: dict[str, str] = {}
    for k, v in resp.headers.items():
        if is_excluded_header(k):
            continue
        got[k.lower()] = normalize(v)

    want = {k.lower(): v for k, v in golden_headers.items()}
    missing = {k: want[k] for k in want if k not in got}
    differing = {k: (got[k], want[k]) for k in want if k in got and got[k] != want[k]}
    extra = {k: got[k] for k in got if k not in want}

    problem = None
    parts = []
    if missing:
        parts.append(f"missing={missing}")
    if differing:
        parts.append(f"differing={differing}")
    if parts:
        problem = "; ".join(parts)
    warning = f"extra={extra}" if extra else None
    return problem, warning


def main() -> int:
    if len(sys.argv) != 2:
        print(__doc__)
        return 2
    base = sys.argv[1].rstrip("/")

    headers: dict[str, str] = {}
    bypass = os.environ.get("VERCEL_AUTOMATION_BYPASS_SECRET")
    if bypass:
        headers["x-vercel-protection-bypass"] = bypass

    passed = failed = skipped = 0
    failures: list[str] = []
    per_scenario: dict[str, list[int]] = {}

    with httpx.Client(base_url=base, headers=headers, timeout=30.0) as client:
        for scenario_path in sorted(SCENARIOS.glob("*.yaml")):
            stem = scenario_path.stem
            if stem in DESTRUCTIVE_SCENARIOS:
                skipped += 1
                print(f"  skip {stem} (exhausts rate-limit buckets)")
                continue
            scenario = yaml.safe_load(scenario_path.read_text())
            golden = json.loads((GOLDEN / f"{stem}.json").read_text())
            golden_steps = golden["steps"]

            # Golden alignment (mirrors test_replay.py): one golden
            # entry per request, `repeat` expanded — advance the index
            # per request and per repeat iteration.
            g_idx = 0
            ran_in_scenario = 0
            scenario_exhausted = False
            for step in scenario["steps"]:
                if scenario_exhausted:
                    break
                if "request" not in step:
                    continue
                req = step["request"]
                repeat = int(step.get("repeat", 1))
                for _ in range(repeat):
                    if g_idx >= len(golden_steps):
                        failures.append(f"{stem}: scenario has more requests than the golden")
                        failed += 1
                        scenario_exhausted = True
                        break
                    g = golden_steps[g_idx]
                    g_idx += 1

                    note = step.get("note", "")
                    if not step_is_remote_safe(step):
                        skipped += 1
                        continue

                    # Guard: the golden entry must be the same request —
                    # a drifting index must fail loudly, not compare the
                    # wrong pair.
                    if (
                        g["request"]["method"] != req["method"]
                        or g["request"]["path"] != req["path"]
                    ):
                        failures.append(
                            f"{stem} golden step {g_idx - 1} is {g['request']['method']} "
                            f"{g['request']['path']}, scenario says {req['method']} {req['path']} "
                            f"({note!r}) — index misalignment"
                        )
                        failed += 1
                        break

                    send_headers = dict(req.get("headers") or {})
                    body = None
                    if "json" in req:
                        body = json.dumps(req["json"]).encode()
                        send_headers.setdefault("Content-Type", "application/json")
                    elif "body_raw" in req:
                        body = req["body_raw"].encode()

                    resp = client.request(
                        req["method"], req["path"], content=body, headers=send_headers
                    )
                    got_raw = normalize(resp.text)

                    problems = []
                    if resp.status_code != g["response"]["status"]:
                        problems.append(f"status {resp.status_code} != {g['response']['status']}")
                    if got_raw != g["response"]["body_raw"]:
                        problems.append(
                            f"body {got_raw[:160]!r} != {g['response']['body_raw'][:160]!r}"
                        )
                    header_problem, header_warning = compare_headers(
                        resp, g["response"].get("headers", {})
                    )
                    if header_problem:
                        problems.append(f"headers: {header_problem}")
                    elif header_warning:
                        print(f"  note  {stem} step {g_idx - 1}: platform headers {header_warning}")
                    if problems:
                        failed += 1
                        failures.append(
                            f"{stem} step {g_idx - 1} ({note!r}): " + "; ".join(problems)
                        )
                        print(f"  FAIL {stem} step {g_idx - 1} ({note})")
                    else:
                        passed += 1
                        ran_in_scenario += 1
                        print(f"  ok   {stem} step {g_idx - 1} ({note})")
            per_scenario[stem] = [ran_in_scenario]

    print()
    print("per-scenario coverage (replayed steps):")
    for stem, (ran,) in sorted(per_scenario.items()):
        print(f"  {stem}: {ran}")
    print(
        f"\nreplay_remote: {passed} passed, {failed} failed, "
        f"{skipped} skipped (need local minting / destructive)"
    )
    for f in failures:
        print(f"  {f}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
