"""Auth routes — the widget-validation endpoints (ADR-002, ADR-008).

Rate limit and body read are FastAPI dependencies (web/deps.py); widget
validation raises ApiError subclasses the app-level handler renders —
no per-route error mapping. Redis/Postgres failures fall through to the
500 envelope.
"""

from __future__ import annotations

from fastapi import Depends
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.responses import Response as StarletteResponse

from ..auth.telegram import (
    TICKET_PURPOSE_GUEST,
    TICKET_PURPOSE_ORGANIZER,
    validate_telegram_widget,
)
from ..auth.ticket import issue_ticket
from ..contracts import models_gen as gen
from ..repositories import organizer_repo
from ..web import json_response
from ..web.deps import get_db_session, ip_rate_limit, request_body


async def telegram_guest(
    _limited: None = Depends(ip_rate_limit("rl:guest:", 10, 60.0)),
    body: bytes = Depends(request_body),
) -> StarletteResponse:
    """POST /api/auth/telegram-guest: validate the Telegram Login Widget
    payload and issue a short-lived ticket proving the messenger
    identity. The identity is echoed back for form prefill; the booking
    endpoint re-reads it from the ticket and never trusts the echo
    (invariant 8)."""
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
    )


async def telegram_signup(
    _limited: None = Depends(ip_rate_limit("rl:signup:", 5, 60.0)),
    body: bytes = Depends(request_body),
    session: AsyncSession = Depends(get_db_session),
) -> StarletteResponse:
    """POST /api/auth/telegram-signup: validate the widget payload via
    HMAC, return {organizerExists, ticket} so the client signs in or
    proceeds to the profile step without re-authenticating. The
    organizer is not created here."""
    identity = validate_telegram_widget(body)

    exists = await organizer_repo.exists_by_messenger(
        session, identity.messenger, identity.messenger_id
    )
    ticket = await issue_ticket(identity.to_ticket_payload(TICKET_PURPOSE_ORGANIZER))

    return json_response(
        200,
        gen.AuthTicketResponse(ticket=ticket, organizerExists=exists),
    )
