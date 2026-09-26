"""Application factory.

The public OpenAPI document is the Zod-rendered one (apps/web/openapi.yaml);
FastAPI never serves its own spec, hence openapi_url/docs/redoc are disabled.
Heavy optional dependencies (boto3, qstash) and engine/Redis clients are
lazy singletons created on first use — never at import time.
"""

from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.responses import PlainTextResponse

from . import config
from .httpx_.middleware import DefaultHeadersAndRecovery, restore_path_middleware

# Go's std ServeMux bodies for unknown routes — byte-identical output,
# never FastAPI's {"detail": …}.
_GO_NOT_FOUND = "404 page not found\n"
_GO_METHOD_NOT_ALLOWED = "405 method not allowed\n"


def create_app() -> FastAPI:
    err = config.validate()
    if err is not None:
        # Env validation fails the cold start loudly on a production
        # misconfiguration; raising here surfaces as a 500 on every
        # request, which is the intended loud failure.
        raise err
    app = FastAPI(openapi_url=None, docs_url=None, redoc_url=None)

    app.middleware("http")(restore_path_middleware)
    app.add_middleware(DefaultHeadersAndRecovery)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(
        request: Request, exc: StarletteHTTPException
    ) -> PlainTextResponse:
        if exc.status_code == 404:
            return PlainTextResponse(_GO_NOT_FOUND, status_code=404)
        if exc.status_code == 405:
            headers = dict(exc.headers) if exc.headers else {}
            return PlainTextResponse(_GO_METHOD_NOT_ALLOWED, status_code=405, headers=headers)
        return PlainTextResponse(str(exc.detail), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> PlainTextResponse:
        # Route handlers validate through the shared validation layer;
        # FastAPI's own body validation should never fire for spec routes,
        # but if it does the response must not be {"detail": …}.
        return PlainTextResponse("Bad Request\n", status_code=400)

    from .routes import register_routes

    register_routes(app)
    return app


app = create_app()
