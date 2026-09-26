# Vercel Python entry (created at the Phase 6 cutover; until then the app
# lives at api/_lib/index.py so Vercel does not auto-discover a half-ported
# Python function next to the deployed Go one). The runtime serves the ASGI
# app exported here; all implementation lives under api/_lib (underscore ⇒
# not a function).
from _lib.countmein.app import app  # noqa: F401
