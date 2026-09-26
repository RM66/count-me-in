"""Middleware: default response headers, panic recovery, and the `_path`
rewrite restoration.

The API origin is reached via beforeFiles rewrites in next.config.js,
so the Next.js headers() config does not apply to its responses — the
API side must set its own:
  - Vary: Accept-Language — API error copy is localized per request
    (ApiErrors dictionaries), so shared caches must key by language.
  - X-Robots-Tag: noindex — mirrors the next.config.js rule for
    /api/:path*; belt-and-braces alongside the meta robots on pages.
"""

from __future__ import annotations

import traceback
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import PlainTextResponse, Response

if TYPE_CHECKING:
    from starlette.responses import Response as StarletteResponse

from .. import logx

DEFAULT_HEADERS = {
    "Vary": "Accept-Language",
    "X-Robots-Tag": "noindex",
    # API responses are per-request (auth, rate limits, live seat
    # counts) — no shared or browser cache may store them.
    "Cache-Control": "no-store",
    # Security headers: the API origin bypasses next.config.js
    # headers(), so the API must set its own. No CSP here — API
    # responses are JSON, never HTML documents.
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}

_MAX_STACK = 8 << 10


def _go_uuid_parse_error(value: str) -> str | None:
    """Mirror google/uuid Parse errors for the router's path-parameter
    binding: wrong length → "invalid UUID length: N", right length with
    bad characters → "invalid UUID format"."""
    if len(value) != 36:
        return f"invalid UUID length: {len(value)}"
    for i, ch in enumerate(value):
        if i in (8, 13, 18, 23):
            if ch != "-":
                return "invalid UUID format"
        elif ch not in "0123456789abcdefABCDEF":
            return "invalid UUID format"
    return None


class DefaultHeadersAndRecovery(BaseHTTPMiddleware):
    """Set the default headers on every response and turn an unhandled
    exception into a logged 500 instead of crashing the function."""

    async def dispatch(
        self, request: Request, call_next: Callable[[Request], Awaitable[StarletteResponse]]
    ) -> StarletteResponse:
        # The generated Go router binds uuid path parameters before the
        # adapter (and its Recover) runs: a non-UUID {id} on /api/slots
        # is answered by http.Error — bare headers (Content-Type +
        # X-Content-Type-Options), no default set, body with trailing
        # newline. The parity goldens pin those bytes.
        path = request.url.path
        if path.startswith("/api/slots/") and "/" not in path[len("/api/slots/") :]:
            value = path[len("/api/slots/") :]
            reason = _go_uuid_parse_error(value)
            if reason is not None:
                resp = PlainTextResponse(
                    "Invalid format for parameter id: "
                    f"error unmarshaling '{value}' text as *uuid.UUID: {reason}\n",
                    status_code=400,
                )
                resp.headers["X-Content-Type-Options"] = "nosniff"
                return resp
        try:
            response: Response = await call_next(request)
        except Exception:
            # The stack is the only trace of where the panic came from —
            # the exception value alone cannot be mapped back to a line.
            # Truncated so a deep recursive failure cannot flood the log.
            stack = "".join(traceback.format_exc())[-_MAX_STACK:]
            logx.error(
                RuntimeError(f"panic: {request.url.path}"),
                {"method": request.method, "path": request.url.path, "stack": stack},
            )
            response = PlainTextResponse(status_code=500)
        # /api/healthz is mounted on the outer mux in Go, outside
        # httpx.Recover — the probe answers bare (Content-Type only), so
        # monitors see dependency state without the API's header set.
        if request.url.path != "/api/healthz":
            for key, value in DEFAULT_HEADERS.items():
                response.headers[key] = value
        return response


def strip_query_param(raw_query: str, key: str) -> str:
    """Remove one key (and its value) from a raw query string, preserving
    the rest verbatim."""
    kept = []
    for part in raw_query.split("&"):
        k = part.split("=", 1)[0]
        if k == key:
            continue
        kept.append(part)
    return "&".join(kept)


async def restore_path_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[StarletteResponse]]
) -> StarletteResponse:
    """vercel.json rewrites each /api/* route to /api/index and carries the
    original path as ?_path=. Vercel sets the request path to the
    destination, so the original path is restored from _path before
    dispatch. Trailing slashes from empty wildcard matches (e.g.
    /api/services/ from :path*) are trimmed so collection routes match.
    """
    orig = request.query_params.get("_path", "")
    if orig:
        # _path is an internal rewrite artifact, never a client input:
        # only /api/... prefixes are ever rewritten here, and anything
        # else is answered 404 rather than dispatched. It is also
        # stripped from the query string so handlers logging the URL do
        # not echo the artifact back.
        if not orig.startswith("/api/"):
            return PlainTextResponse("404 page not found\n", status_code=404)
        if orig != "/":
            orig = orig.rstrip("/") or orig
        scope_path = orig
        raw_query = strip_query_param(request.url.query, "_path")
        request.scope["path"] = scope_path
        request.scope["raw_path"] = scope_path.encode()
        request.scope["query_string"] = raw_query.encode()
    return await call_next(request)
