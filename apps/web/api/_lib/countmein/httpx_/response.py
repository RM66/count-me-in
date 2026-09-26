"""Route-handler plumbing shared by every endpoint: responses, guards,
error mapping, recovery. Request-level concerns only: sessions,
tickets, body parsing. Mapping *entity* failure modes onto status codes
lives in errors.py, deliberately split from the pure plumbing.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from starlette.responses import Response as StarletteResponse

from .. import logx
from ..contracts.constants_gen import DEMO_READ_ONLY_CODE
from ..contracts.models_gen import ErrorBody, InvalidBody, InvalidIssuesBody, ValidationErrors
from ..i18n import api_error
from .gojson import dumps_go


@dataclass
class Response:
    """A ready-to-write JSON response. Guards return one instead of writing
    directly so callers keep the single-expression opening of the TS
    handlers (check for None, never truthiness)."""

    status: int
    body: Any = None  # None → empty body
    headers: Mapping[str, str] = field(default_factory=dict)

    def to_starlette(self) -> StarletteResponse:
        from starlette.responses import Response as StarletteResponse

        headers = dict(self.headers)
        if self.body is None:
            return StarletteResponse(status_code=self.status, headers=headers, background=None)
        try:
            payload = dumps_go(_marshal_body(self.body))
        except Exception as err:  # encoding failure answered cleanly
            logx.error(err, {"scope": "api", "op": "marshal-response"})
            return StarletteResponse(status_code=500, headers=headers)
        raw = payload.encode("utf-8")
        headers["Content-Type"] = "application/json"
        headers["Content-Length"] = str(len(raw))
        return StarletteResponse(content=raw, status_code=self.status, headers=headers)


def _marshal_body(body: Any) -> Any:
    # mode="json": python-mode dumps keep AnyUrl/UUID objects that the
    # JSON encoder cannot write (a 500 on every media-upload response);
    # json mode renders them as their canonical strings, matching Go's
    # marshaling of url.URL / [16]byte.
    if isinstance(body, ErrorBody):
        # Go's ErrorBody marks code/seatsLeft/maxSeats omitempty — the
        # plain error body is {"error": …} with the extras only when set.
        dumped = body.model_dump(mode="json", exclude_none=False, by_alias=True)
        return {k: v for k, v in dumped.items() if v is not None or k == "error"}
    if hasattr(body, "model_dump"):
        return body.model_dump(mode="json", exclude_none=False, by_alias=True)
    return body


def json_response(status: int, body: Any) -> Response:
    return Response(status=status, body=body)


def empty(status: int) -> Response:
    return Response(status=status)


def internal(err: BaseException) -> Response:
    """Log the error and return an empty 500 — the analogue of an unhandled
    throw in a Next.js route handler (no JSON body)."""
    logx.error(err, {"scope": "api"})
    return empty(500)


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


def demo_read_only(locale: str) -> Response:
    """The 403 every write path answers for the demo account or anonymous
    visitors (ADR-010)."""
    return error_extras(
        403, locale, "demoReadOnly", None, ErrorBody(error="", code=DEMO_READ_ONLY_CODE)
    )


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
