"""Application factory.

The public OpenAPI document is the Zod-rendered one (apps/web/openapi.yaml);
FastAPI never serves its own spec, hence openapi_url/docs/redoc are disabled.
Heavy optional dependencies (boto3, qstash) and engine/Redis clients are
lazy singletons created on first use — never at import time.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import Response as StarletteResponse

from . import config
from .web.middleware import DefaultHeadersAndRecovery, RestorePathMiddleware


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncIterator[None]:
    """The single owner of resource disposal. Clients stay lazy
    (built on first use, never at startup — the cold-start rule); the
    shutdown side closes whatever was actually opened, best-effort —
    a disposal failure must not mask the response already sent."""
    yield
    from . import logx
    from . import redis as redis_mod
    from .db import client as db_client
    from .web import async_client

    for name, dispose in (
        ("engine", db_client.dispose),
        ("redis", redis_mod.dispose),
        ("http", async_client.dispose),
    ):
        try:
            await dispose()
        except Exception as err:
            logx.error(err, {"scope": "api", "op": "lifespan-close", "resource": name})


def create_app() -> FastAPI:
    # Env validation fails the cold start loudly on a production
    # misconfiguration; raising here surfaces as a 500 on every
    # request, which is the intended loud failure.
    config.validate()
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None, lifespan=_lifespan)

    # add_middleware inserts at the head of the stack, so listing
    # RestorePathMiddleware first leaves DefaultHeadersAndRecovery
    # outermost — the same nesting the old app.middleware("http") +
    # add_middleware pair produced.
    app.add_middleware(RestorePathMiddleware)
    app.add_middleware(DefaultHeadersAndRecovery)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> StarletteResponse:
        # Unknown routes and methods answer the JSON error envelope
        # (localized), never FastAPI's {"detail": …}.
        from .i18n.locale import detect_locale
        from .web.response import method_not_allowed, not_found

        locale = detect_locale(request.cookies, request.headers.get("accept-language", ""))
        if exc.status_code == 404:
            return not_found(locale).to_starlette()
        if exc.status_code == 405:
            resp = method_not_allowed(locale)
            if exc.headers:
                resp.headers = {**resp.headers, **dict(exc.headers)}
            return resp.to_starlette()
        return StarletteResponse(status_code=exc.status_code, headers=dict(exc.headers or {}))

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> StarletteResponse:
        # Route handlers validate through the shared validation layer;
        # FastAPI's own body validation should never fire for spec routes,
        # but if it does the response must not be {"detail": …}.
        from .i18n.locale import detect_locale
        from .web.response import error

        locale = detect_locale(request.cookies, request.headers.get("accept-language", ""))
        return error(400, locale, "invalidInput").to_starlette()

    from .errors import ApiError, ValidationFailed
    from .i18n.locale import detect_locale
    from .web import invalid_body, invalid_issues

    @app.exception_handler(ApiError)
    async def api_error_handler(request: Request, exc: ApiError) -> StarletteResponse:
        # Domain errors render through the single conversion point in the
        # transport (web/response.render_api_error); anything else keeps
        # propagating to the 500 recovery middleware. Locale comes from the
        # same cookies + Accept-Language the handlers use.
        locale = detect_locale(request.cookies, request.headers.get("accept-language", ""))
        from .web.response import render_api_error

        return render_api_error(exc, locale).to_starlette()

    @app.exception_handler(ValidationFailed)
    async def validation_failed_handler(
        request: Request, exc: ValidationFailed
    ) -> StarletteResponse:
        # Body-shape 400s: the register route answers with issues
        # (fieldErrors only), every other route with details — the flag
        # on the exception selects the shape, so handlers no longer
        # catch ValidationFailed locally.
        locale = detect_locale(request.cookies, request.headers.get("accept-language", ""))
        if exc.issues:
            return invalid_issues(locale, exc.errors).to_starlette()
        return invalid_body(locale, exc.errors).to_starlette()

    from .routes import register_routes

    register_routes(app)
    return app


app = create_app()
