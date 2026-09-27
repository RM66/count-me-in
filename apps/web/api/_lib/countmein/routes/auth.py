"""Auth routes — the widget-validation endpoints (ADR-002, ADR-008).

The rate limit and body read are FastAPI dependencies (web/deps.py); the
widget validation itself stays in the handler because its error mapping
(TelegramNotConfigured/Invalid/ValidationFailed → distinct localized
bodies) is route-specific. Everything else — Redis or Postgres failures
during ticket issue or the organizer lookup — falls through to the
global exception handler, which logs and returns the same 500 envelope
without per-route boilerplate.
"""

from __future__ import annotations

from fastapi import Depends
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from ..auth.telegram import (
    TICKET_PURPOSE_GUEST,
    TICKET_PURPOSE_ORGANIZER,
    TelegramInvalidError,
    TelegramNotConfiguredError,
    TelegramValidationFailedError,
    validate_telegram_widget,
)
from ..auth.ticket import issue_ticket
from ..contracts import models_gen as gen
from ..db import organizer as db_organizer
from ..web import Response, error, json_response
from ..web.deps import ip_rate_limit, locale, request_body


def _widget_error_response(err: Exception, loc: str) -> Response:
    if isinstance(err, TelegramNotConfiguredError):
        return error(500, loc, "telegramNotConfigured")
    if isinstance(err, TelegramInvalidError):
        return error(400, loc, "telegramInvalid")
    return error(400, loc, "telegramValidationFailed")


async def telegram_guest(
    request: Request,
    loc: str = Depends(locale),
    _limited: None = Depends(ip_rate_limit("rl:guest:", 10, 60.0)),
    body: bytes = Depends(request_body),
) -> StarletteResponse:
    """POST /api/auth/telegram-guest: validate the Telegram Login Widget
    payload and issue a short-lived ticket proving the messenger
    identity. The identity is echoed back so the booking form can
    prefill the name; the booking endpoint re-reads it from the ticket
    server-side and never trusts the echo (invariant 8)."""
    try:
        identity = validate_telegram_widget(body)
    except (
        TelegramNotConfiguredError,
        TelegramInvalidError,
        TelegramValidationFailedError,
    ) as err:
        return _widget_error_response(err, loc).to_starlette()

    ticket = await issue_ticket(identity.to_ticket_payload(TICKET_PURPOSE_GUEST))

    return json_response(
        200,
        gen.GuestTicketResponse(
            ticket=ticket,
            messenger=identity.messenger,  # type: ignore[arg-type]
            messengerId=identity.messenger_id,
            displayName=identity.display_name,
        ),
    ).to_starlette()


async def telegram_signup(
    request: Request,
    loc: str = Depends(locale),
    _limited: None = Depends(ip_rate_limit("rl:signup:", 5, 60.0)),
    body: bytes = Depends(request_body),
) -> StarletteResponse:
    """POST /api/auth/telegram-signup: validates the widget payload via
    HMAC, then returns {organizerExists, ticket} so the client either
    signs in directly or proceeds to the profile step without
    re-authenticating. The organizer is not created here — the profile
    form POSTs to /api/organizers."""
    try:
        identity = validate_telegram_widget(body)
    except (
        TelegramNotConfiguredError,
        TelegramInvalidError,
        TelegramValidationFailedError,
    ) as err:
        return _widget_error_response(err, loc).to_starlette()

    exists = await db_organizer.exists_organizer_by_messenger(
        identity.messenger, identity.messenger_id
    )
    ticket = await issue_ticket(identity.to_ticket_payload(TICKET_PURPOSE_ORGANIZER))

    return json_response(
        200,
        gen.AuthTicketResponse(ticket=ticket, organizerExists=exists),
    ).to_starlette()
