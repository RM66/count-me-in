"""Route-handler plumbing shared by every endpoint: responses, guards,
error mapping, recovery. Request-level concerns only: sessions,
tickets, body parsing. Mapping *entity* failure modes onto status codes
lives in errors.py, deliberately split from the pure plumbing — the one
error→Response conversion point (render_api_error) lives here in the
transport, wired by the app-level exception handler in app.py.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from starlette.responses import Response as StarletteResponse

from .. import logx
from ..contracts.models_gen import ErrorBody, InvalidBody, ValidationErrors
from ..errors import ApiError
from ..i18n import api_error
from .json_enc import dumps_compact


class CompactJSONResponse(StarletteResponse):
    """A JSON response rendered with the compact encoder: one response
    class whose render() produces the exact bytes the wire contract
    pins — compact separators, UTF-8 text, field order from the
    model, no trailing newline."""

    def __init__(self, body: Any, status: int = 200, headers: Mapping[str, str] | None = None):
        self._body = body
        merged = dict(headers or {})
        merged.setdefault("Content-Type", "application/json")
        super().__init__(content=None, status_code=status, headers=merged)

    def render(self, content: Any) -> bytes:
        return dumps_compact(_marshal_body(self._body)).encode("utf-8")


@dataclass
class Response:
    """A ready-to-write JSON response. Guards return one instead of writing
    directly so callers keep the single-expression opening of the TS
    handlers (check for None, never truthiness)."""

    status: int
    body: Any = None  # None → empty body
    headers: Mapping[str, str] = field(default_factory=dict)

    def to_starlette(self) -> StarletteResponse:
        headers = dict(self.headers)
        if self.body is None:
            return StarletteResponse(status_code=self.status, headers=headers, background=None)
        try:
            return CompactJSONResponse(self.body, status=self.status, headers=headers)
        except Exception as err:  # encoding failure answered cleanly
            logx.error(err, {"scope": "api", "op": "marshal-response"})
            return StarletteResponse(status_code=500, headers=headers)


def _marshal_body(body: Any) -> Any:
    # mode="json": python-mode dumps keep AnyUrl/UUID objects that the
    # JSON encoder cannot write (a 500 on every media-upload response);
    # json mode renders them as their canonical strings.
    if isinstance(body, ErrorBody):
        # seatsLeft/maxSeats are optional extras — code is not (ADR-024):
        # every error body is {error, code, …}, extras only when set.
        dumped = body.model_dump(mode="json", exclude_none=False, by_alias=True)
        return {k: v for k, v in dumped.items() if v is not None or k in ("error", "code")}
    if hasattr(body, "model_dump"):
        return body.model_dump(mode="json", exclude_none=False, by_alias=True)
    return body


def json_response(status: int, body: Any) -> Response:
    return Response(status=status, body=body)


def empty(status: int) -> Response:
    return Response(status=status)


def not_found(locale: str) -> Response:
    """The JSON 404 envelope for unknown routes — localized like every
    other API error, never plain text."""
    return error(404, locale, "notFound")


def method_not_allowed(locale: str) -> Response:
    """The JSON 405 envelope for known paths with an unregistered
    method."""
    return error(405, locale, "methodNotAllowed")


def error(status: int, locale: str, key: str, code: str | None = None) -> Response:
    """Render {error: <localized message>, code} — the body carries the
    caller's locale (ADR-011) and a machine-readable code (ADR-024);
    the i18n key doubles as the code unless the wire pins a different
    token."""
    return Response(
        status=status,
        body=ErrorBody(error=api_error(locale, key), code=code or key),
    )


def render_api_error(exc: ApiError, locale: str) -> Response:
    """Render an ApiError into its wire Response — the single conversion
    point, called by the app-level exception handler (app.py). The error
    classes carry only data (status, key, params, extras, headers);
    this is where that data becomes bytes, so the parity goldens stay
    byte-identical with the retired to_response method."""
    key = exc.response_key()
    extras = exc.extras()
    if extras is not None:
        resp = error_extras(exc.status, locale, key, exc.params(), extras)
    else:
        params = exc.params()
        if params is not None:
            resp = error_params(exc.status, locale, key, params, code=exc.code())
        else:
            resp = error(exc.status, locale, key, code=exc.code())
    headers = exc.headers()
    if headers is not None:
        resp.headers = {**resp.headers, **headers}
    return resp


def error_params(
    status: int,
    locale: str,
    key: str,
    params: Mapping[str, Any] | None,
    code: str | None = None,
) -> Response:
    return Response(
        status=status,
        body=ErrorBody(error=api_error(locale, key, params), code=code or key),
    )


def error_extras(
    status: int,
    locale: str,
    key: str,
    params: Mapping[str, Any] | None,
    extras: ErrorBody,
) -> Response:
    extras.error = api_error(locale, key, params)
    return Response(status=status, body=extras)


def invalid_body(locale: str, errs: Any) -> Response:
    """Body-parse 400: a localized generic as the top-level error,
    Zod-style details for logs/devtools only."""
    from ..validation.errors import Errors

    if errs is None:
        errs = Errors()
    return json_response(
        400,
        InvalidBody(
            error=api_error(locale, "invalidInput"),
            code="invalidInput",
            details=ValidationErrors(formErrors=errs.form, fieldErrors=errs.fields),
        ),
    )
