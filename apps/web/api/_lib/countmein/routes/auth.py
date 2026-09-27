"""Auth routes — the widget-validation endpoints (ADR-002, ADR-008).

TelegramGuest and TelegramSignup are deliberately separate endpoints: a
guest gets no session at all (the ticket is spent on one booking or one
lookup), and sharing the route would let a guest ticket be redeemed as
an organizer sign-in. Ported from the retired implementation.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from starlette.requests import Request

if TYPE_CHECKING:
    from starlette.responses import Response as StarletteResponse

from ..auth import (
    TelegramInvalidError,
    TelegramNotConfiguredError,
    TelegramValidationFailedError,
    issue_ticket,
    validate_telegram_widget,
)
from ..auth.telegram import TICKET_PURPOSE_GUEST, TICKET_PURPOSE_ORGANIZER
from ..contracts import models_gen as gen
from ..db import organizer as db_organizer
from ..httpx_ import Response, error, internal, json_response
from ..httpx_.guards import read_body_or_413
from ..httpx_.ratelimit import RateLimitConfig, client_ip, rate_limited
from ..i18n.locale import detect_locale


def _locale(request: Request) -> str:
    return detect_locale(request.cookies, request.headers.get("accept-language", ""))


def _widget_error_response(err: Exception, locale: str) -> Response:
    if isinstance(err, TelegramNotConfiguredError):
        return error(500, locale, "telegramNotConfigured")
    if isinstance(err, TelegramInvalidError):
        return error(400, locale, "telegramInvalid")
    return error(400, locale, "telegramValidationFailed")


async def telegram_guest(request: Request) -> StarletteResponse:
    """POST /api/auth/telegram-guest: validate the Telegram Login Widget
    payload and issue a short-lived ticket proving the messenger
    identity. The identity is echoed back so the booking form can
    prefill the name; the booking endpoint re-reads it from the ticket
    server-side and never trusts the echo (invariant 8)."""
    locale = _locale(request)
    limited = await rate_limited(
        request, "rl:guest:" + client_ip(request), RateLimitConfig(limit=10, window=60.0)
    )
    if limited is not None:
        return limited.to_starlette()

    body, resp = await read_body_or_413(request)
    if resp is not None:
        return resp.to_starlette()
    try:
        identity = validate_telegram_widget(body)  # type: ignore[arg-type]
    except Exception as err:
        if not isinstance(
            err, (TelegramNotConfiguredError, TelegramInvalidError, TelegramValidationFailedError)
        ):
            return internal(err).to_starlette()
        return _widget_error_response(err, locale).to_starlette()

    try:
        ticket = await issue_ticket(identity.to_ticket_payload(TICKET_PURPOSE_GUEST))
    except Exception as err:
        return internal(err).to_starlette()

    return json_response(
        200,
        gen.GuestTicketResponse(
            ticket=ticket,  # type: ignore[arg-type]
            messenger=identity.messenger,  # type: ignore[arg-type]
            messengerId=identity.messenger_id,  # type: ignore[arg-type]
            displayName=identity.display_name,
        ),
    ).to_starlette()


async def telegram_signup(request: Request) -> StarletteResponse:
    """POST /api/auth/telegram-signup: validates the widget payload via
    HMAC, then returns {organizerExists, ticket} so the client either
    signs in directly or proceeds to the profile step without
    re-authenticating. The organizer is not created here — the profile
    form POSTs to /api/organizers."""
    locale = _locale(request)
    limited = await rate_limited(
        request, "rl:signup:" + client_ip(request), RateLimitConfig(limit=5, window=60.0)
    )
    if limited is not None:
        return limited.to_starlette()

    body, resp = await read_body_or_413(request)
    if resp is not None:
        return resp.to_starlette()
    try:
        identity = validate_telegram_widget(body)  # type: ignore[arg-type]
    except Exception as err:
        if not isinstance(
            err, (TelegramNotConfiguredError, TelegramInvalidError, TelegramValidationFailedError)
        ):
            return internal(err).to_starlette()
        return _widget_error_response(err, locale).to_starlette()

    try:
        exists = await db_organizer.exists_organizer_by_messenger(
            identity.messenger, identity.messenger_id
        )
    except Exception as err:
        return internal(err).to_starlette()

    try:
        ticket = await issue_ticket(identity.to_ticket_payload(TICKET_PURPOSE_ORGANIZER))
    except Exception as err:
        return internal(err).to_starlette()

    return json_response(
        200,
        gen.AuthTicketResponse(ticket=ticket, organizerExists=exists),  # type: ignore[arg-type]
    ).to_starlette()
