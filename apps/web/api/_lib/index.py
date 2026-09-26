# Vercel Python entry (created at the Phase 6 cutover; until then the app
# lives at api/_lib/index.py so Vercel does not auto-discover a half-ported
# Python function next to the deployed Go one). The runtime serves the ASGI
# app exported here; all implementation lives under api/_lib (underscore ⇒
# not a function).
#
# Local dev parity with cmd/dev: the Go dev server loads .env before
# starting (real environment always wins). uvicorn imports this module
# before the app, so the loader runs at import time — but only outside
# Vercel, where the platform injects the real env.
from __future__ import annotations

import os


def _load_dot_env(path: str) -> None:
    """Port of cmd/dev's loadDotEnv: fill unset variables from a .env
    file. The real environment always wins — a variable exported by the
    shell (or passed by Playwright's webServer env) is never
    overwritten, so a local .env cannot leak into an explicitly
    configured run."""
    try:
        with open(path, encoding="utf-8") as fh:
            data = fh.read()
    except OSError:
        return  # no .env — rely on the real environment
    for line in data.split("\n"):
        line = line.strip()
        if line == "" or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("\"'")
        if key != "" and os.environ.get(key, "") == "":
            os.environ[key] = value


if os.environ.get("VERCEL", "") == "":
    _load_dot_env(".env")

from _lib.countmein.app import app  # noqa: F401, E402
