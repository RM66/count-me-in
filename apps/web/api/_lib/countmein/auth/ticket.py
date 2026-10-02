"""Short-lived auth tickets (ADR-008): issued after server-side HMAC
validation of the Telegram Login Widget payload; single-use (a replayed
booking fails), 10-minute TTL. Key: auth:ticket:{token}.
"""

from __future__ import annotations

import base64
import json
import secrets
from datetime import timedelta
from typing import Any

from .. import redis as redis_mod
from ..contracts.payloads import AuthTicketPayload, LoginLinkPayload

TICKET_TTL = timedelta(minutes=10)
TICKET_KEY_PREFIX = "auth:ticket:"
_TICKET_BYTES = 32


def ticket_key(token: str) -> str:
    return TICKET_KEY_PREFIX + token


def new_secret_token() -> str:
    """A 32-byte base64url token (43 chars) — sized to be unguessable
    rather than short: it is never typed by hand."""
    return base64.urlsafe_b64encode(secrets.token_bytes(_TICKET_BYTES)).rstrip(b"=").decode()


async def issue_ticket(payload: AuthTicketPayload) -> str:
    """Store the identity behind a fresh one-shot token."""
    token = new_secret_token()
    await redis_mod.client().set(
        ticket_key(token), json.dumps(payload.to_json()), ex=int(TICKET_TTL.total_seconds())
    )
    return token


async def _missing_or_broken(raw: Any, err: BaseException | None) -> AuthTicketPayload | None:
    """Map "no payload usable" to None; a Redis failure (other than a
    missing key) propagates as an exception."""
    if err is not None:
        raise err
    if raw is None:
        return None
    try:
        return AuthTicketPayload.from_json(json.loads(raw))
    except (ValueError, KeyError):
        return None


async def peek_ticket(token: str) -> AuthTicketPayload | None:
    """Read a ticket without consuming it — the registration form is in
    flight and the Auth.js sign-in still needs the ticket."""
    r = redis_mod.client()
    raw = await r.get(ticket_key(token))
    return await _missing_or_broken(raw, None)


async def consume_ticket(token: str) -> AuthTicketPayload | None:
    """Atomically read and delete a ticket (GETDEL) — what makes it
    single-use: two concurrent redemptions race on one Redis command and
    only the winner receives a payload."""
    r = redis_mod.client()
    raw = await r.getdel(ticket_key(token))
    return await _missing_or_broken(raw, None)


async def consume_guest_ticket(token: str) -> AuthTicketPayload:
    """Redeem a *guest-purpose* ticket: consume it and answer the
    identity behind it, or raise TicketExpired. The only place a guest
    ticket is spent — guards.py (booking lookup, where nothing precedes
    consumption) and booking_service.create_guest_booking (after the
    domain refusals, ADR-024 B1) both go through here, so the
    purpose check and the failure semantics cannot drift.

    Purpose claim: a ticket minted for organizer registration must not
    be redeemable in the booking flow. Answered like an expired one —
    the caller cannot distinguish "wrong flow" from "unknown ticket"."""
    from .. import logx
    from ..errors import TicketExpired
    from .telegram import TICKET_PURPOSE_GUEST

    try:
        payload = await consume_ticket(token)
    except Exception as err:
        # Identity is NOT fail-open (ADR-019): a Redis outage is a 500.
        # Logged here (with scope) because the recovery middleware sees
        # only a bare RuntimeError.
        logx.error(err, {"scope": "consume-ticket"})
        raise RuntimeError("ticket consumption failed") from err
    if payload is None or payload.purpose != TICKET_PURPOSE_GUEST:
        raise TicketExpired()
    return payload


# ── One-time login links ─────────────────────────────────────────────────────
# Notifications deep-link into the cabinet, but /cabinet needs no
# session — without one the organizer would land in the read-only demo
# cabinet (ADR-010). Minted per send attempt; a retry mints a fresh
# token and the abandoned one simply expires.

from ..contracts.constants_gen import LOGIN_LINK_TTL_SECONDS  # noqa: E402
from ..contracts.domain import login_link_key  # noqa: E402


async def issue_login_link(organizer_id: str, next: str) -> str:
    """Store {organizerId, next} behind a fresh token."""
    token = new_secret_token()
    payload = LoginLinkPayload(organizer_id=organizer_id, next=next)
    await redis_mod.client().set(
        login_link_key(token), json.dumps(payload.to_json()), ex=LOGIN_LINK_TTL_SECONDS
    )
    return token


def _is_safe_next_path(next: str) -> bool:
    """A relative cabinet path only: starts with "/", but not "//"
    (scheme-relative URL) or "/\\" (backslash trick that browsers
    normalize to a protocol-relative URL). Backslashes and control
    characters are rejected anywhere in the value: browsers treat
    "\\foo" as "/foo" and embedded CR/LF/NUL can split responses in
    downstream consumers."""
    if not next or next[0] != "/":
        return False
    if next.startswith("//") or next.startswith("/\\"):
        return False
    for c in next:
        if c == "\\" or ord(c) < 0x20 or ord(c) == 0x7F:
            return False
    return True


async def _parse_login_link(raw: Any) -> LoginLinkPayload | None:
    if raw is None:
        return None
    try:
        payload = LoginLinkPayload.from_json(json.loads(raw))
    except (ValueError, KeyError):
        return None
    # `next` is always a relative path built server-side (open-redirect
    # guard, mirrored from the loginLinkPayload schema).
    if payload.organizer_id == "" or not _is_safe_next_path(payload.next):
        return None
    return payload


async def peek_login_link(token: str) -> LoginLinkPayload | None:
    """Read without consuming — the landing page must be able to look
    at a token without spending it, because link previewers fetch URLs
    before any human does."""
    raw = await redis_mod.client().get(login_link_key(token))
    return await _parse_login_link(raw)


async def consume_login_link(token: str) -> LoginLinkPayload | None:
    """Atomically read and delete (GETDEL): single-use, so a replayed
    POST cannot mint a second session."""
    raw = await redis_mod.client().getdel(login_link_key(token))
    return await _parse_login_link(raw)
