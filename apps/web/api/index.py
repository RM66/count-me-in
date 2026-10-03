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
    wins — an exported variable is never overwritten, so a local .env
    cannot leak into an explicitly configured run.

    Deliberately minimal, not dotenv-compatible: only `KEY=value` lines
    with optional surrounding quotes. The repo's .env files are
    hand-written in exactly that shape; anything richer belongs in the
    real environment, not in a parser grown around it."""
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
    # Resolve from the module location, not cwd: apps/web (the parent of
    # api/) owns .env. The monorepo root .env is a fallback — apps/web/.env
    # is a symlink to it, but the symlink is gitignored and absent on a
    # fresh clone.
    _dir = os.path.dirname(__file__)
    _load_dot_env(os.path.join(_dir, "..", ".env"))
    _load_dot_env(os.path.join(_dir, "..", "..", "..", ".env"))

# Vercel's runtime imports this entrypoint by absolute path and does NOT
# put its directory on sys.path (unlike `uvicorn --app-dir api` locally).
# Both `api/` (this module) and `api/_lib` (the package root, so imports
# resolve as `countmein.*` — the underscore stays a disk-level Vercel
# convention) go on the path.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
_LIB = os.path.join(_HERE, "_lib")
if _LIB not in sys.path:
    sys.path.insert(0, _LIB)

from countmein.app import app  # noqa: F401, E402
