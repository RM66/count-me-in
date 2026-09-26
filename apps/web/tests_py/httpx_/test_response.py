"""Ported from pkg/httpx/response_test.go: the response-writing plumbing.

Response.to_starlette's branches, the invalid-body/issue renderers, and
the default-header middleware + panic→500. These are the seams every
route handler sits on, so their contracts are pinned here.
"""

import httpx
from _lib.countmein.contracts.constants_gen import LOCALES
from _lib.countmein.httpx_.gojson import dumps_go
from _lib.countmein.httpx_.response import (
    empty,
    error,
    invalid_body,
    invalid_issues,
    json_response,
)
from _lib.countmein.validation.errors import Errors


def test_response_write_nil_body_writes_only_status():
    resp = empty(204).to_starlette()
    assert resp.status_code == 204
    assert resp.body == b""


def test_response_write_headers_before_status():
    resp = error(429, "en", "tooManyRequests")
    resp.headers = {"Retry-After": "30"}
    star = resp.to_starlette()
    assert star.status_code == 429
    assert star.headers["Retry-After"] == "30"


def test_response_write_body_sets_content_type_and_length():
    star = json_response(418, {"a": "b"}).to_starlette()
    assert star.status_code == 418
    assert star.headers["Content-Type"] == "application/json"
    assert star.headers["Content-Length"] == str(len(star.body))
    assert b'"a"' in star.body


def test_response_marshal_failure_answers_500():
    # An unencodable value drives the encode-failure branch.
    resp = json_response(200, {"bad": object()})
    star = resp.to_starlette()
    assert star.status_code == 500


def test_gojson_html_escapes_and_sorts():
    # Go's encoding/json HTML-escapes < > & and sorts map keys.
    assert dumps_go({"b": 1, "a": "<x>&"}) == '{"a":"\\u003cx\\u003e\\u0026","b":1}'


def test_gojson_compact_separators():
    assert dumps_go({"x": [1, 2], "y": "z"}) == '{"x":[1,2],"y":"z"}'


def test_invalid_body_renderers():
    # nil errors still render an empty details shape
    resp = invalid_body("en", None)
    assert resp.status == 400
    # details carry form and field errors
    errs = Errors()
    errs.add("name", "required")
    resp = invalid_body("en", errs)
    assert resp.status == 400
    body = resp.body.model_dump()
    assert body["details"]["fieldErrors"] == {"name": ["required"]}


def test_invalid_issues_renderers():
    resp = invalid_issues("en", None)
    assert resp.status == 400
    assert resp.body.issues == {}
    errs = Errors()
    errs.add("slug", "reserved")
    resp = invalid_issues("en", errs)
    assert resp.status == 400
    assert resp.body.issues == {"slug": ["reserved"]}


def test_error_body_localized_for_every_locale():
    for locale in LOCALES:
        resp = error(404, locale, "bookingNotFound")
        assert resp.body.error, f"{locale}: localized error copy must not be empty"


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

    from _lib.countmein.httpx_.middleware import DefaultHeadersAndRecovery

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


async def test_unknown_route_answers_go_mux_404():
    from _lib.countmein.app import create_app

    app = create_app()
    async with _client(app) as client:
        r = await client.get("/api/does-not-exist")
        assert r.status_code == 404
        assert r.text == "404 page not found\n"


async def test_path_restoration_middleware():
    from _lib.countmein.app import create_app

    app = create_app()
    async with _client(app) as client:
        # _path is restored and stripped; non-/api prefixes are 404.
        r = await client.get("/api/index", params={"_path": "/api/healthz"})
        assert r.status_code in (200, 503)
        r = await client.get("/api/index", params={"_path": "/evil/thing"})
        assert r.status_code == 404
        assert r.text == "404 page not found\n"


def test_strip_query_param():
    from _lib.countmein.httpx_.middleware import strip_query_param

    assert strip_query_param("a=1&_path=/x&b=2", "_path") == "a=1&b=2"
    assert strip_query_param("_path=/x", "_path") == ""
    assert strip_query_param("a=1", "_path") == "a=1"
