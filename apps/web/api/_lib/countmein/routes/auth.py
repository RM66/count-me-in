"""Auth routes — the widget-validation endpoints (ADR-002, ADR-008).

The rate limit and body read are FastAPI dependencies (web/deps.py); the
widget validation raises ApiError subclasses (TelegramNotConfigured /
TelegramInvalid / TelegramValidationFailedError) that the app-level
exception handler renders into their distinct localized bodies — the
route carries no error mapping of its own. Everything else — Redis or
Postgres failures during ticket issue or the organizer lookup — falls
through to the global exception handler, which logs and returns the same
500 envelope without per-route boilerplate.
"""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request
from starlette.responses import Response as StarletteResponse

from ..auth.telegram import (
    TICKET_PURPOSE_GUEST,
    TICKET_PURPOSE_ORGANIZER,
    validate_telegram_widget,
)
from ..auth.ticket import issue_ticket
from ..contracts import models_gen as gen
from ..services import organizer_service
from ..web import json_response
from ..web.deps import get_db_session, ip_rate_limit, request_body


async def telegram_guest(
    request: Request,
    _limited: None = Depends(ip_rate_limit("rl:guest:", 10, 60.0)),
    body: bytes = Depends(request_body),
) -> StarletteResponse:
    """POST /api/auth/telegram-guest: validate the Telegram Login Widget
    payload and issue a short-lived ticket proving the messenger
    identity. The identity is echoed back so the booking form can
    prefill the name; the booking endpoint re-reads it from the ticket
    server-side and never trusts the echo (invariant 8)."""
    identity = validate_telegram_widget(body)

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
    _limited: None = Depends(ip_rate_limit("rl:signup:", 5, 60.0)),
    body: bytes = Depends(request_body),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/auth/telegram-signup: validates the widget payload via
    HMAC, then returns {organizerExists, ticket} so the client either
    signs in directly or proceeds to the profile step without
    re-authenticating. The organizer is not created here — the profile
    form POSTs to /api/organizers."""
    identity = validate_telegram_widget(body)

    exists = await organizer_service.exists_organizer_by_messenger(
        session, identity.messenger, identity.messenger_id
    )
    ticket = await issue_ticket(identity.to_ticket_payload(TICKET_PURPOSE_ORGANIZER))

    return json_response(
        200,
        gen.AuthTicketResponse(ticket=ticket, organizerExists=exists),
    ).to_starlette()
