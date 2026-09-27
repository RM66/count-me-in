"""Route-handler plumbing shared by every endpoint: responses, guards,
error mapping, recovery. Request-level concerns only: sessions,
tickets, body parsing. Mapping *entity* failure modes onto status codes
lives in errors.py, deliberately split from the pure plumbing.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from starlette.responses import Response as StarletteResponse

from .. import logx
from ..contracts.models_gen import ErrorBody, InvalidBody, InvalidIssuesBody, ValidationErrors
from ..i18n import api_error
from .jsonenc import dumps_compact


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
        # code/seatsLeft/maxSeats are optional extras — the plain error
        # body is {"error": …} with the extras only when set.
        dumped = body.model_dump(mode="json", exclude_none=False, by_alias=True)
        return {k: v for k, v in dumped.items() if v is not None or k == "error"}
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


def error(status: int, locale: str, key: str) -> Response:
    """Render {error: <localized message>} — the body carries the caller's
    locale (ADR-011)."""
    return Response(status=status, body=ErrorBody(error=api_error(locale, key)))


def error_params(status: int, locale: str, key: str, params: Mapping[str, Any] | None) -> Response:
    return Response(status=status, body=ErrorBody(error=api_error(locale, key, params)))


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
            details=ValidationErrors(formErrors=errs.form, fieldErrors=errs.fields),
        ),
    )


def invalid_issues(locale: str, errs: Any) -> Response:
    """The register route's 400: issues (fieldErrors only) instead of
    details, mirroring its TS shape."""
    fields: dict[str, list[str]] = {}
    if errs is not None and errs.fields is not None:
        fields = errs.fields
    return json_response(
        400,
        InvalidIssuesBody(error=api_error(locale, "invalidInput"), issues=fields),
    )
