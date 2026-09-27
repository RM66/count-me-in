"""Permanent parity golden regenerator.

Replays every scenario in tests_py/parity/scenarios/ against the
in-process Python app and writes the transcript to
tests_py/parity/golden/{scenario}.json. The retired Go recorder is
gone, so this script is the one and only way the goldens are produced
— the replay test (test_replay.py) and this script share the same
harness code, so a golden can only drift if the app's behavior drifts.

Usage (from apps/web/, with Postgres and Redis up):

    uv run python -m tests_py.parity.record            # rewrite all goldens
    uv run python -m tests_py.parity.record slots       # rewrite matching ones

Review the diff by hand before committing: a golden change is a wire
change and must be recorded in ADR-021.
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

import httpx
import redis.asyncio as aioredis
from httpx import ASGITransport

import tests_py.parity.test_replay as replay

HERE = Path(__file__).resolve().parent


async def main(argv: list[str]) -> int:
    patterns = argv[1:]
    scenarios = sorted((HERE / "scenarios").glob("*.yaml"))
    if patterns:
        scenarios = [p for p in scenarios if any(pat in p.stem for pat in patterns)]
    if not scenarios:
        print("no matching scenarios", file=sys.stderr)
        return 1

    # Same pinned env + app construction as the replay fixture.
    import os

    saved = {k: os.environ.get(k) for k in replay.ENV_OVERRIDES}
    removed = {k: os.environ[k] for k in replay.ENV_REMOVED if k in os.environ}
    os.environ.update(replay.ENV_OVERRIDES)
    for k in replay.ENV_REMOVED:
        os.environ.pop(k, None)

    from _lib.countmein import redis as redis_mod
    from _lib.countmein.app import create_app
    from _lib.countmein.db import client as db_client

    db_client.reset_for_test()
    redis_mod.reset_for_test()
    app = create_app()
    sink = replay.Sink()
    sink.install()
    r = aioredis.from_url(replay.REDIS_URL)
    try:
        transport = ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport, base_url=replay.BASE, timeout=30.0
        ) as client:
            for scenario_path in scenarios:
                sink.calls.clear()
                transcript = await replay.run_scenario(client, r, scenario_path, sink)
                out = HERE / "golden" / f"{scenario_path.stem}.json"
                out.write_text(json.dumps(transcript, ensure_ascii=False, indent=2) + "\n")
                print(f"recorded {scenario_path.stem} ({len(transcript['steps'])} steps)")
    finally:
        sink.uninstall()
        await r.aclose()
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        os.environ.update(removed)
        db_client.reset_for_test()
        redis_mod.reset_for_test()
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main(sys.argv)))
