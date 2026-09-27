"""The Python app's route set must equal openapi.yaml's: every (method, path) pair in the Zod-rendered spec has a
registered handler, and every registered route is in the spec.
/api/healthz is infrastructure outside the spec (mounted in the app
factory like Go's NewMux mounts it outside the generated router)."""

from __future__ import annotations

from pathlib import Path

import yaml


def _spec_routes() -> set[tuple[str, str]]:
    spec = yaml.safe_load((Path(__file__).resolve().parents[1] / "openapi.yaml").read_text())
    routes: set[tuple[str, str]] = set()
    for path, item in spec["paths"].items():
        for method, op in item.items():
            if method in {"get", "post", "put", "patch", "delete"} and isinstance(op, dict):
                routes.add((method.upper(), path))
    return routes


def _app_routes() -> set[tuple[str, str]]:
    from _lib.countmein.routes import register_routes
    from fastapi import FastAPI

    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)
    register_routes(app)
    routes: set[tuple[str, str]] = set()
    for route in app.routes:
        methods = getattr(route, "methods", None)
        if not methods:
            continue
        for method in methods:
            if method == "HEAD":
                continue
            routes.add((method, route.path))
    return routes


def test_route_set_equals_spec() -> None:
    spec = _spec_routes()
    app = _app_routes()
    # /api/healthz is the one route outside the spec (infrastructure
    # probe, ADR-016 — same exception as Go's NewMux).
    assert app - spec == {("GET", "/api/healthz")}, f"routes not in spec: {app - spec}"
    assert spec - app == set(), f"spec routes missing from the app: {spec - app}"
