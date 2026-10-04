"""The response-writing plumbing.

The helpers return ready Starlette responses — the invalid-body/issue
renderers, and the default-header middleware + panic→500. These are the
seams every route handler sits on, so their contracts are pinned here.
"""

import json

import httpx
from countmein.contracts.constants_gen import LOCALES
from countmein.validation.errors import Errors
from countmein.web.json_enc import dumps_compact
from countmein.web.response import (
    empty,
    error,
    invalid_body,
    json_response,
)


def test_response_write_nil_body_writes_only_status():
    resp = empty(204)
    assert resp.status_code == 204
    assert resp.body == b""


def test_response_write_headers_before_status():
    resp = json_response(429, {"error": "slow down"}, headers={"Retry-After": "30"})
    assert resp.status_code == 429
    assert resp.headers["Retry-After"] == "30"


def test_response_write_body_sets_content_type_and_length():
    star = json_response(418, {"a": "b"})
    assert star.status_code == 418
    assert star.headers["Content-Type"] == "application/json"
    assert star.headers["Content-Length"] == str(len(star.body))
    assert b'"a"' in star.body


def test_response_marshal_failure_answers_500():
    # An unencodable value drives the encode-failure branch.
    resp = json_response(200, {"bad": object()})
    assert resp.status_code == 500


def test_jsonenc_keeps_text_verbatim():
    # stdlib compact JSON — no HTML escaping, insertion key order.
    assert dumps_compact({"b": 1, "a": "<x>&"}) == '{"b":1,"a":"<x>&"}'


def test_jsonenc_compact_separators():
    assert dumps_compact({"x": [1, 2], "y": "z"}) == '{"x":[1,2],"y":"z"}'


def test_invalid_body_renderers():
    # nil errors still render an empty details shape
    resp = invalid_body("en", None)
    assert resp.status_code == 400
    # details carry form and field errors
    errs = Errors()
    errs.add("name", "required")
    resp = invalid_body("en", errs)
    assert resp.status_code == 400
    body = json.loads(resp.body)
    assert body["details"]["fieldErrors"] == {"name": ["required"]}


def test_error_body_localized_for_every_locale():
    for locale in LOCALES:
        resp = error(404, locale, "bookingNotFound")
        body = json.loads(resp.body)
        assert body["error"], f"{locale}: localized error copy must not be empty"


def _client(app) -> httpx.AsyncClient:
    # httpx.ASGITransport instead of starlette.testclient (deprecated):
    # same in-process call surface without the TestClient wrapper.
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def test_middleware_sets_headers_and_recovers():
    from fastapi import FastAPI

    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)

    @app.get("/api/x")
    async def x():
        return {"ok": True}

    @app.get("/api/boom")
    async def boom():
        raise RuntimeError("kaboom")

    from countmein.web.middleware import DefaultHeadersAndRecovery

    app.add_middleware(DefaultHeadersAndRecovery)
    async with _client(app) as client:
        r = await client.get("/api/x")
        assert r.status_code == 200
        assert r.headers["Vary"] == "Accept-Language"
        assert r.headers["X-Robots-Tag"] == "noindex"
        assert r.headers["Cache-Control"] == "no-store"
        assert r.headers["X-Content-Type-Options"] == "nosniff"
        assert r.headers["X-Frame-Options"] == "DENY"
        assert r.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
        assert r.headers["Permissions-Policy"] == "camera=(), microphone=(), geolocation=()"
        assert r.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"

        r = await client.get("/api/boom")
        assert r.status_code == 500


async def test_unknown_route_answers_json_404():
    from countmein.app import create_app

    app = create_app()
    async with _client(app) as client:
        r = await client.get("/api/does-not-exist")
        assert r.status_code == 404
        assert r.json() == {"error": "Not found", "code": "notFound"}
        assert r.headers["content-type"] == "application/json"


async def test_path_restoration_middleware():
    from countmein.app import create_app

    app = create_app()
    async with _client(app) as client:
        # _path is restored and stripped; non-/api prefixes are 404.
        r = await client.get("/api/index", params={"_path": "/api/healthz"})
        assert r.status_code in (200, 503)
        r = await client.get("/api/index", params={"_path": "/evil/thing"})
        assert r.status_code == 404
        assert r.json() == {"error": "Not found", "code": "notFound"}


def test_strip_query_param():
    from countmein.web.middleware import strip_query_param

    assert strip_query_param("a=1&_path=/x&b=2", "_path") == "a=1&b=2"
    assert strip_query_param("_path=/x", "_path") == ""
    assert strip_query_param("a=1", "_path") == "a=1"
