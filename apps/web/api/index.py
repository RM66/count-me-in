# Vercel Python entry: the single ASGI function every /api/* rewrite lands
# on (vercel.json). All implementation lives under api/_lib (underscore ⇒
# not auto-discovered as a function); this module only loads the app.
#
# Local dev loads .env before starting (real environment always wins).
# uvicorn imports this module before the app, so the loader runs at import
# time — but only outside Vercel, where the platform injects the real env.
from __future__ import annotations

import os
import sys


def _load_dot_env(path: str) -> None:
    """Fill unset variables from a .env file. The real environment always
    wins — a variable exported by the shell (or passed by Playwright's
    webServer env) is never overwritten, so a local .env cannot leak into
    an explicitly configured run.

    Deliberately minimal, not dotenv-compatible: no `export ` prefixes,
    no multi-line or escaped values, no variable interpolation — only
    `KEY=value` lines with optional surrounding quotes. The repo's .env
    files are hand-written in exactly that shape; anything richer belongs
    in the real environment, not in a parser grown around it."""
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
    # Resolve from the module location, not cwd: uvicorn may be started
    # from any directory; apps/web (the parent of api/) is the project
    # root that owns .env.
    _load_dot_env(os.path.join(os.path.dirname(__file__), "..", ".env"))

# Vercel's runtime imports this entrypoint by absolute path and does NOT
# put its directory on sys.path (unlike `uvicorn --app-dir api` locally),
# so `_lib` next to this file is unimportable without this.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from _lib.countmein.app import app  # noqa: F401, E402
