"""Post-cutover 5xx rate check (migration plan §6.3).

Usage (from apps/web/):
    bunx vercel logs <deployment-url> --json --since 30m \
        | uv run python scripts/migration/errors_rate.py
    uv run python scripts/migration/errors_rate.py --from-cli   # runs vercel logs

Rollback criterion: the share of 5xx responses within 30 min exceeds
1%. This script parses the log stream, counts 5xx vs non-5xx request
statuses, and exits 1 when the rate is above the threshold.

Exit codes:
- 0  — within threshold (healthy)
- 1  — 5xx share above 1% (ROLLBACK), or no request statuses at all
- 3  — inconclusive: fewer than MIN_REQUESTS distinct requests in the
       window. This is NOT a rollback signal — a small service may not
       see 50 requests in 30 minutes. Widen the window (`--since 2h`)
       or fall back to the smoke check as the criterion.

Counting rules:
- `vercel logs --json` emits one JSON object per line; the request
  status is read from `proxy.statusCode` / `statusCode` / `status`.
  A plain-text fallback parser handles non-JSON CLI output.
- One REQUEST is counted once: the app's own logx line and Vercel's
  access line for the same request are deduplicated by request id
  (`id` / `requestId` / `x-vercel-id`).
- Pass the production deployment URL explicitly — without it the CLI
  logs whatever the current directory is linked to.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys

THRESHOLD = 0.01  # 1%
MIN_REQUESTS = 50

STATUS_KEYS = ("proxy.statusCode", "statusCode", "status")
ID_KEYS = ("id", "requestId", "x-vercel-id")
TEXT_STATUS_RE = re.compile(r'"status(?:Code)?"\s*:\s*(\d{3})')

EXIT_ROLLBACK = 1
EXIT_INCONCLUSIVE = 3


def _dig(obj: dict, dotted: str):
    cur: object = obj
    for part in dotted.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(part)
    return cur


def parse(text: str) -> tuple[list[int], int]:
    """Returns (statuses, duplicates_skipped). Prefers JSON lines; a
    non-JSON line falls back to a regex status scan (no dedupe possible
    there, so such lines are counted but flagged by the caller)."""
    statuses: list[int] = []
    seen_ids: set[str] = set()
    unkeyed = 0
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            m = TEXT_STATUS_RE.search(line)
            if m:
                statuses.append(int(m.group(1)))
                unkeyed += 1
            continue
        if not isinstance(obj, dict):
            continue
        status = next((v for k in STATUS_KEYS if (v := _dig(obj, k)) is not None), None)
        if not isinstance(status, int):
            continue
        rid = next((v for k in ID_KEYS if (v := _dig(obj, k)) is not None), None)
        if isinstance(rid, str) and rid:
            if rid in seen_ids:
                continue
            seen_ids.add(rid)
        statuses.append(status)
    return statuses, unkeyed


def run_vercel_logs() -> str:
    vercel = shutil.which("vercel") or shutil.which("bunx")
    if not vercel:
        print("errors_rate: vercel/bunx not found on PATH")
        raise SystemExit(2)
    cmd = [vercel, "logs", "--json", "--since", "30m", "--environment", "production"]
    if vercel.endswith("bunx"):
        cmd.insert(1, "vercel")
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)  # noqa: S603
    if proc.returncode != 0:
        print(f"errors_rate: vercel logs failed: {proc.stderr.strip()[:300]}")
        raise SystemExit(2)
    return proc.stdout


def main() -> int:
    from_cli = "--from-cli" in sys.argv
    if len(sys.argv) > 1 and not from_cli:
        print(__doc__)
        return 2

    if from_cli:
        text = run_vercel_logs()
    else:
        text = sys.stdin.read()
        if not text.strip() and sys.stdin.isatty():
            # Interactive terminal with nothing piped — the operator
            # almost certainly meant the CLI mode.
            text = run_vercel_logs()

    statuses, unkeyed = parse(text)
    if not statuses:
        print("errors_rate: no request statuses found in the log stream — cannot prove health")
        return EXIT_ROLLBACK
    if unkeyed:
        print(f"errors_rate: {unkeyed} status(es) from non-JSON lines counted without dedupe")

    if len(statuses) < MIN_REQUESTS:
        print(
            f"errors_rate: only {len(statuses)} requests in the window "
            f"(< {MIN_REQUESTS}) — inconclusive, widen the window or rely on smoke; "
            "NOT a rollback signal"
        )
        return EXIT_INCONCLUSIVE

    s5xx = [s for s in statuses if 500 <= s < 600]
    rate = len(s5xx) / len(statuses)
    print(f"errors_rate: {len(s5xx)} 5xx of {len(statuses)} requests ({rate:.2%}) in the window")
    if rate > THRESHOLD:
        print(
            "errors_rate: 5xx share above 1% — ROLLBACK "
            "(bunx vercel rollback, then git revert the merge)"
        )
        return EXIT_ROLLBACK
    print("errors_rate: within threshold")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
