"""Route-handler plumbing shared by every endpoint: responses and the
one error→Response conversion point (render_api_error), wired by the
app-level handler in app.py. Helpers return ready Starlette responses.
"""

from __future__ import annotations

from collections.abc import Mapping
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


def json_response(
    status: int, body: Any = None, headers: Mapping[str, str] | None = None
) -> StarletteResponse:
    """A ready-to-send JSON response; None body → empty."""
    if body is None:
        return StarletteResponse(status_code=status, headers=dict(headers or {}))
    try:
        return CompactJSONResponse(body, status=status, headers=headers)
    except Exception as err:  # encoding failure answered cleanly
        logx.error(err, {"scope": "api", "op": "marshal-response"})
        return StarletteResponse(status_code=500, headers=dict(headers or {}))


def empty(status: int) -> StarletteResponse:
    return StarletteResponse(status_code=status)


def not_found(locale: str) -> StarletteResponse:
    """The JSON 404 envelope for unknown routes — localized, never
    plain text."""
    return error(404, locale, "notFound")


def method_not_allowed(locale: str) -> StarletteResponse:
    """The JSON 405 envelope for known paths with an unregistered
    method."""
    return error(405, locale, "methodNotAllowed")


def error(status: int, locale: str, key: str, code: str | None = None) -> StarletteResponse:
    """Render {error: <localized message>, code} — caller's locale
    (ADR-011), machine-readable code (ADR-024); the i18n key doubles as
    the code unless the wire pins a different token."""
    return json_response(
        status,
        ErrorBody(error=api_error(locale, key), code=code or key),
    )


def render_api_error(exc: ApiError, locale: str) -> StarletteResponse:
    """Render an ApiError into its wire response — the single conversion
    point, called by the app-level handler (app.py). Error classes
    carry only data (status, key, code, params, extra, headers); this
    is where it becomes bytes, keeping the parity goldens
    byte-identical."""
    body = ErrorBody(
        error=api_error(locale, exc.key, exc.params),
        code=exc.code or exc.key,
        **(exc.extra or {}),
    )
    return json_response(exc.status, body, headers=exc.headers)


def invalid_body(locale: str, errs: Any) -> StarletteResponse:
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
