"""Route-handler plumbing shared by every endpoint: responses, guards,
error mapping, recovery. Mapping *entity* failure modes onto status
codes lives in errors.py; the one error→Response conversion point
(render_api_error) lives here, wired by the app-level handler in app.py.
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
    """JSON rendered with the compact encoder — the exact bytes the wire
    contract pins: compact separators, UTF-8, model field order, no
    trailing newline."""

    def __init__(self, body: Any, status: int = 200, headers: Mapping[str, str] | None = None):
        self._body = body
        merged = dict(headers or {})
        merged.setdefault("Content-Type", "application/json")
        super().__init__(content=None, status_code=status, headers=merged)

    def render(self, content: Any) -> bytes:
        return dumps_compact(_marshal_body(self._body)).encode("utf-8")


@dataclass
class Response:
    """A ready-to-write JSON response. Guards return one instead of
    writing directly (check for None, never truthiness)."""

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
    # mode="json": python-mode dumps keep AnyUrl/UUID objects the JSON
    # encoder cannot write; json mode renders canonical strings.
    if isinstance(body, ErrorBody):
        # Every error body is {error, code, …}; optional extras
        # (seatsLeft/maxSeats) only when set (ADR-024).
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
    """The JSON 404 envelope for unknown routes — localized, never
    plain text."""
    return error(404, locale, "notFound")


def method_not_allowed(locale: str) -> Response:
    """The JSON 405 envelope for known paths with an unregistered
    method."""
    return error(405, locale, "methodNotAllowed")


def error(status: int, locale: str, key: str, code: str | None = None) -> Response:
    """Render {error: <localized message>, code} — caller's locale
    (ADR-011), machine-readable code (ADR-024); the i18n key doubles as
    the code unless the wire pins a different token."""
    return Response(
        status=status,
        body=ErrorBody(error=api_error(locale, key), code=code or key),
    )


def render_api_error(exc: ApiError, locale: str) -> Response:
    """Render an ApiError into its wire Response — the single conversion
    point, called by the app-level handler (app.py). Error classes carry
    only data (status, key, params, extras, headers); this is where it
    becomes bytes, keeping the parity goldens byte-identical."""
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
