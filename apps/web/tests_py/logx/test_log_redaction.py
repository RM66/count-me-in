"""Log redaction: secrets never reach the log lines.

Two doors, both enforced here:

1. Dynamic — the real app is driven with a request that carries every
   secret class the API ever sees (the organizer session header
   `X-Organizer-Auth`, cookies, a guest ticket and a manageToken in the
   body), the formatted log lines are captured at the logger level,
   and none of the secret values may appear in them.
2. Static — no logx call site in the package passes a request body,
   headers or cookies into the log fields. The dynamic door only
   covers the paths a test drives; the static one forbids the pattern
   outright, so a future call site cannot reintroduce it. The scan is
   AST-based (a call spanning several lines is one node). It is honest
   about its limit: a secret smuggled through an intermediate variable
   is not caught here — the dynamic door is the net for that.
"""

from __future__ import annotations

import ast
import json
import logging
from pathlib import Path

import httpx
import pytest
from httpx import ASGITransport

PACKAGE = Path(__file__).resolve().parents[2] / "api" / "_lib" / "countmein"

# Attribute/name fragments that must never appear inside a logx call's
# arguments: request payloads, headers, cookies, or a credential by
# name. Matched against the AST of every call, so multi-line calls are
# covered.
_FORBIDDEN_SOURCE_TOKENS = (
    "request.body",
    "request.headers",
    "request.cookies",
    "manageToken",
    "guestTicket",
    "Authorization",
    "upstash-signature",
)

_LOGX_FUNCS = {"info", "warn", "error", "warn_every"}


def _logx_call_sources() -> list[tuple[Path, int, str]]:
    """Every logx call in the package, as (file, line, source snippet).
    Parsed with ast, so a call whose arguments span lines is one node."""
    sites: list[tuple[Path, int, str]] = []
    for path in sorted(PACKAGE.rglob("*.py")):
        if path.name.endswith("_gen.py"):
            continue
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if (
                isinstance(func, ast.Attribute)
                and func.attr in _LOGX_FUNCS
                and isinstance(func.value, ast.Name)
                and func.value.id == "logx"
            ):
                sites.append((path, node.lineno, ast.unparse(node)))
    return sites


def test_logx_call_sites_never_log_request_secrets():
    """Static door: every logx call in the package is inspected — none
    may reference a request body, headers, cookies, or a credential by
    name. The request middleware logs method/path/status only."""
    sites = _logx_call_sources()
    assert sites, "the scanner must find call sites — a broken glob is a silent pass"
    for path, line_no, source in sites:
        for token in _FORBIDDEN_SOURCE_TOKENS:
            assert token not in source, (
                f"{path.name}:{line_no} logs request data ({token!r}): {source}"
            )


class _Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__()
        self.lines: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.lines.append(self.format(record))


@pytest.fixture()
def capture():
    """Capture the formatted lines the countmein logger emits while the
    request is served — the same bytes the stdout handler writes."""
    from countmein import logx

    handler = _Capture()
    handler.setFormatter(logx._JsonFormatter())
    logger = logging.getLogger("countmein")
    logger.addHandler(handler)
    try:
        yield handler
    finally:
        logger.removeHandler(handler)


MARKERS = {
    # The real session bearer the API reads (auth/session.py) — the
    # header a signed-in organizer actually sends.
    "organizer_auth": "SECRETMARK-organizer-auth",
    "cookie": "SECRETMARK-cookie-value",
    "guest_ticket": "SECRETMARK-guest-ticket",
    "manage_token": "SECRETMARK-manage-token",
    "x_vercel_id": "SECRETMARK-vercel-request-id",
}


async def _drive_app_with_secrets(capture) -> None:
    """POST a booking-shaped request whose every secret-bearing slot
    carries a unique marker value, through the real middleware chain."""
    from countmein.app import create_app
    from countmein.auth.session import ORGANIZER_AUTH_HEADER

    app = create_app()
    transport = ASGITransport(app=app)
    capture.lines.clear()
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        await client.post(
            "/api/bookings",
            headers={
                ORGANIZER_AUTH_HEADER: MARKERS["organizer_auth"],
                "Cookie": f"next-auth.session-token={MARKERS['cookie']}",
                # x-vercel-id IS logged (as request_id) — a marker here
                # proves the allowlist copies that one header verbatim,
                # and only that one.
                "x-vercel-id": MARKERS["x_vercel_id"],
                "content-type": "application/json",
            },
            content=(
                '{"serviceId":"svc-xxxxxxxxxxxxxxxx","timeSlotId":'
                '"01930000-0000-7000-8000-000000000001","seats":1,'
                '"guestName":"Ann","guestTicket":"'
                + MARKERS["guest_ticket"]
                + '","manageToken":"'
                + MARKERS["manage_token"]
                + '"}'
            ).encode(),
        )


async def test_request_logs_never_contain_secrets(capture):
    """Dynamic door: the middleware's request line and every handler
    log line emitted while serving a secret-bearing request must not
    contain any of the secret values. The booking fails (unknown
    ticket) — that is fine: the point is what the failure path logs."""
    await _drive_app_with_secrets(capture)
    assert capture.lines, "the request must produce at least one log line"
    joined = "\n".join(capture.lines)
    for name, value in MARKERS.items():
        if name == "x_vercel_id":
            continue  # request_id is deliberately logged (see below)
        assert value not in joined, f"secret {name!r} leaked into the log output"


async def test_request_log_line_shape(capture):
    """The access-log line carries method, path, status, duration_ms and
    the x-vercel-id request id — and nothing else from the request
    (no query string, no headers, no body)."""
    await _drive_app_with_secrets(capture)
    request_lines = []
    for line in capture.lines:
        try:
            rec = json.loads(line)
        except ValueError:
            continue
        if rec.get("msg") == "request":
            request_lines.append(rec)
    assert request_lines, "the middleware must log one 'request' line"
    rec = request_lines[-1]
    assert rec["method"] == "POST"
    assert rec["path"] == "/api/bookings"
    assert isinstance(rec["status"], int)
    assert isinstance(rec["duration_ms"], (int, float))
    assert rec["request_id"] == MARKERS["x_vercel_id"], (
        "x-vercel-id is the platform correlation id — it is the one "
        "header the request line copies, verbatim"
    )
    # The request line is a fixed field set — no request payload rides
    # along under an extra key.
    assert set(rec) == {
        "time",
        "level",
        "msg",
        "method",
        "path",
        "status",
        "duration_ms",
        "request_id",
    }
