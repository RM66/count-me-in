"""Middleware: default response headers, panic recovery, and the `_path`
rewrite restoration — pure ASGI: no BaseHTTPMiddleware, whose
task-based call_next is known to break contextvars and background
tasks; both middlewares here are plain scope/receive/send wrappers.

The API origin is reached via beforeFiles rewrites in next.config.js,
so the Next.js headers() config does not apply to its responses — the
API side must set its own:
  - Vary: Accept-Language — API error copy is localized per request
    (api-errors dictionaries), so shared caches must key by language.
  - X-Robots-Tag: noindex — mirrors the next.config.js rule for
    /api/:path*; belt-and-braces alongside the meta robots on pages.
"""

from __future__ import annotations

import time
import traceback
from typing import Any
from urllib.parse import parse_qsl

from starlette.datastructures import MutableHeaders
from starlette.responses import PlainTextResponse
from starlette.responses import Response as StarletteResponse
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .. import logx

DEFAULT_HEADERS = {
    "Vary": "Accept-Language",
    "X-Robots-Tag": "noindex",
    # API responses are per-request (auth, rate limits, live seat
    # counts) — no shared or browser cache may store them.
    "Cache-Control": "no-store",
    # The API origin bypasses next.config.js headers(), so it sets its
    # own. No CSP — API responses are JSON, never HTML.
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
}

_MAX_STACK = 8 << 10


def _not_found_response(scope: Scope) -> StarletteResponse:
    """The JSON 404 envelope for a non-/api/ _path — localized like
    every other API error. Wrapping the scope in a Request reuses the
    cookie + Accept-Language rule of deps.locale."""

    from starlette.requests import Request

    from ..i18n.locale import detect_locale
    from .response import not_found

    request = Request(scope)
    locale = detect_locale(request.cookies, request.headers.get("accept-language", ""))
    return not_found(locale).to_starlette()


def _query_param(scope: Scope, key: str) -> str | None:
    """One query parameter from the raw query string (first value wins,
    like starlette's QueryParams)."""
    qs = scope.get("query_string", b"").decode("latin-1")
    for k, v in parse_qsl(qs, keep_blank_values=True):
        if k == key:
            return str(v)
    return None


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


class RestorePathMiddleware:
    """vercel.json rewrites each /api/* route to /api/index and carries the
    original path as ?_path=. Vercel sets the request path to the
    destination, so the original path is restored from _path before
    dispatch. Trailing slashes from empty wildcard matches (e.g.
    /api/services/ from :path*) are trimmed so collection routes match.

    A scope rewrite, not a request wrapper: the downstream app sees the
    restored path in the very scope dict the outer middleware shares.
    """

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        # Only the rewrite destination may carry a trusted _path:
        # elsewhere it is client input — a _path on /api/bookings must
        # not steer dispatch (ADR-024).
        if scope["path"] != "/api/index":
            await self.app(scope, receive, send)
            return
        orig = _query_param(scope, "_path") or ""
        if orig:
            # _path is an internal rewrite artifact: only /api/...
            # prefixes are honored, anything else is 404. Stripped from
            # the query string so logged URLs don't echo it.
            if not orig.startswith("/api/"):
                resp = _not_found_response(scope)
                await resp(scope, receive, send)
                return
            if orig != "/":
                orig = orig.rstrip("/") or orig
            raw_query = strip_query_param(scope.get("query_string", b"").decode("latin-1"), "_path")
            scope["path"] = orig
            scope["raw_path"] = orig.encode()
            scope["query_string"] = raw_query.encode("latin-1")
        await self.app(scope, receive, send)


class DefaultHeadersAndRecovery:
    """Set the default headers on every response, log one line per
    request, and turn an unhandled exception into a logged 500 instead
    of crashing the function."""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = time.perf_counter()
        response_started = False
        # /api/healthz answers bare (Content-Type only) and is outside
        # the access log — monitors poll it continuously and would flood
        # the drain (platform probe logs cover it).
        is_healthz = scope["path"] == "/api/healthz"
        status: dict[str, Any] = {"code": None}

        async def send_wrapper(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
                status["code"] = message["status"]
                # The scope dict is shared with RestorePathMiddleware —
                # by now the path is the restored, post-rewrite one.
                if scope["path"] != "/api/healthz":
                    headers = MutableHeaders(scope=message)
                    for key, value in DEFAULT_HEADERS.items():
                        headers[key] = value
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            # The stack is the only trace of where the panic came from;
            # truncated so a deep recursion cannot flood the log.
            stack = "".join(traceback.format_exc())[-_MAX_STACK:]
            logx.error(
                RuntimeError(f"panic: {scope['path']}"),
                {"method": scope["method"], "path": scope["path"], "stack": stack},
            )
            if response_started:
                # The response head already went out — a second
                # http.response.start would corrupt the stream. Log,
                # drop the connection; the client sees a truncated body.
                raise
            status["code"] = 500
            resp = PlainTextResponse(status_code=500)
            if scope["path"] != "/api/healthz":
                for key, value in DEFAULT_HEADERS.items():
                    resp.headers[key] = value
            await resp(scope, receive, send)
        finally:
            if not is_healthz and status["code"] is not None:
                self._access_log(scope, status["code"], started)

    @staticmethod
    def _access_log(scope: Scope, code: int, started: float) -> None:
        """One access-log line per request — in a finally, so the early
        returns above log too. x-vercel-id is Vercel's per-request
        correlation id — function and platform log lines join on it."""
        fields: dict[str, object] = {
            "method": scope["method"],
            "path": scope["path"],
            "status": code,
            "duration_ms": round((time.perf_counter() - started) * 1000, 1),
        }
        request_id = ""
        for k, v in scope.get("headers", []):
            if k == b"x-vercel-id":
                request_id = v.decode("latin-1")
                break
        if request_id:
            fields["request_id"] = request_id
        logx.info("request", fields)
