"""Middleware behavior: the 405 JSON envelope and the recovery
middleware's double-start guard.

The 405 envelope is part of the wire contract (unknown methods answer
the localized JSON error, never FastAPI's {"detail": …}); the
double-start guard keeps a mid-response crash from corrupting the
stream with a second http.response.start.
"""

from __future__ import annotations

import json

import httpx
import pytest
from countmein.web.middleware import DefaultHeadersAndRecovery


@pytest.fixture()
async def client():
    from countmein.app import create_app

    transport = httpx.ASGITransport(app=create_app())
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as c:
        yield c


async def test_method_not_allowed_answers_json_envelope(client):
    """DELETE on a known path (GET-only) answers the localized JSON 405
    envelope with an Allow header — never FastAPI's {"detail": …}."""
    resp = await client.delete("/api/organizers/me")
    assert resp.status_code == 405
    assert resp.headers["content-type"] == "application/json"
    body = json.loads(resp.text)
    assert set(body) == {"error", "code"}, f"unexpected 405 body: {body}"
    assert body["error"], "the localized message must be present"
    assert body["code"] == "methodNotAllowed"
    assert "allow" in {k.lower() for k in resp.headers}


async def test_unknown_route_answers_json_envelope(client):
    resp = await client.get("/api/no-such-route")
    assert resp.status_code == 404
    assert resp.headers["content-type"] == "application/json"
    body = json.loads(resp.text)
    assert set(body) == {"error", "code"}
    assert body["code"] == "notFound"


async def test_path_restores_only_on_the_rewrite_destination(client):
    """ADR-024 A1: vercel rewrites land on /api/index with the original
    path in ?_path. There the parameter is honored…"""
    resp = await client.get("/api/index", params={"_path": "/api/healthz"})
    assert resp.status_code == 200


async def test_path_param_on_a_real_path_does_not_steer_dispatch(client):
    """…but on any other path _path is untrusted client input and must
    not steer dispatch: a forged _path on a real route is ignored, and
    the request answers with that route's own response."""
    resp = await client.get("/api/organizers/me", params={"_path": "/api/no-such-route"})
    assert resp.status_code == 200
    assert "organizer" in resp.json()  # the real route ran, no restore to a 404


async def test_path_param_outside_api_prefix_answers_404(client):
    """On the rewrite destination a _path outside /api/ is still refused —
    the gate narrows where restoration applies, not what it may restore
    to."""
    resp = await client.get("/api/index", params={"_path": "/cabinet"})
    assert resp.status_code == 404
    assert resp.headers["content-type"] == "application/json"


async def test_path_param_order_is_irrelevant(client):
    """Two _path parameters cannot smuggle a non-/api/ dispatch past the
    first-wins rule — the rejected value is the one that is seen."""
    resp = await client.get("/api/index?_path=/cabinet&_path=/api/healthz")
    assert resp.status_code == 404
    resp = await client.get("/api/index?_path=/api/healthz&_path=/cabinet")
    assert resp.status_code == 200


async def test_recovery_after_response_start_does_not_double_start():
    """An exception raised after http.response.start went out must not
    send a second response head — the middleware logs and re-raises; the
    client sees a truncated response."""

    started: list[bool] = []

    async def app(scope, receive, send):
        await send({"type": "http.response.start", "status": 200, "headers": []})
        started.append(True)
        raise RuntimeError("boom mid-body")

    wrapped = DefaultHeadersAndRecovery(app)
    sent_starts: list[int] = []

    async def send(message):
        if message["type"] == "http.response.start":
            sent_starts.append(message["status"])

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/slots",
        "headers": [],
        "query_string": b"",
    }
    with pytest.raises(RuntimeError):
        await wrapped(scope, receive=None, send=send)  # type: ignore[arg-type]
    assert started, "the inner app must have started the response"
    assert sent_starts == [200], "no second http.response.start may be sent"


async def test_recovery_before_response_start_answers_500():
    """An exception before any response head answers the plain 500 with
    the default headers — the original recovery behavior."""

    async def app(scope, receive, send):
        raise RuntimeError("boom before start")

    wrapped = DefaultHeadersAndRecovery(app)
    sent_starts: list[int] = []
    sent_bodies: list[bytes] = []

    async def send(message):
        if message["type"] == "http.response.start":
            sent_starts.append(message["status"])
        elif message["type"] == "http.response.body":
            sent_bodies.append(message.get("body", b""))

    scope = {
        "type": "http",
        "method": "GET",
        "path": "/api/slots",
        "headers": [],
        "query_string": b"",
    }
    await wrapped(scope, receive=None, send=send)  # type: ignore[arg-type]
    assert sent_starts == [500]
    assert sent_bodies == [b""]
